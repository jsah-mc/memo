import { app, ipcMain, shell, type IpcMainEvent } from "electron";
import { appendFileSync, statSync, truncateSync } from "node:fs";
import path from "node:path";
import {
  ensureGatewayRunning,
  GATEWAY_BASE_URL,
  restartManagedGateway,
} from "./gateway-process";
import { getComposioKey, setComposioKey } from "./settings-store";
import {
  startDesktopControlIndicator,
  stopDesktopControlIndicator,
} from "./desktop-control-indicator";
import { createWorkspaceCheckpoint } from "./workspace";

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

type ChatRequest = {
  id: string;
  agent: {
    cli: string;
    model: string;
    composioEnabled: boolean;
    composioUserId: string;
    composioToolkits: readonly string[];
    computerTarget: "host" | "local_vm" | "vps";
  };
  messages: ChatMessage[];
};

type AgentProfileRequest = {
  name: string;
  role: string;
  instructions: string;
  cli: string;
  model: string;
  color: string;
  computerTarget: "host" | "local_vm" | "vps";
};

type OpenAIStreamChunk = {
  object?: string;
  tool_call?: {
    id?: unknown;
    name?: unknown;
    arguments?: unknown;
    result?: unknown;
    is_error?: unknown;
  };
  image?: {
    data?: unknown;
    media_type?: unknown;
    model?: unknown;
    prompt?: unknown;
  };
  permission?: {
    id?: unknown;
    kind?: unknown;
    command?: unknown;
    cwd?: unknown;
    os_isolated?: unknown;
  };
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

const controllers = new Map<string, AbortController>();
const speechControllers = new Map<string, AbortController>();
const permissionResponses = new Map<
  string,
  {
    senderId: number;
    resolve: (allowed: boolean) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

type ChatStreamEvent =
  | { id: string; type: "delta"; content: string }
  | {
      id: string;
      type: "tool-call";
      toolCall: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        result?: unknown;
        isError?: boolean;
      };
    }
  | {
      id: string;
      type: "image";
      image: string;
      model?: string;
      prompt?: string;
    }
  | { id: string; type: "done" }
  | { id: string; type: "error"; message: string };

type SpeechStreamEvent =
  | { id: string; type: "chunk"; audio: string }
  | { id: string; type: "done" }
  | { id: string; type: "error"; message: string };

type SpeechTranscriptionRequest = {
  audio: string;
  mimeType: string;
  filename: string;
};

function traceVoice(stage: string, details = "") {
  try {
    const logPath = path.join(app.getPath("userData"), "memo-voice.log");
    try {
      if (statSync(logPath).size > 512 * 1024) truncateSync(logPath);
    } catch {
      // The file is created by appendFileSync below.
    }
    appendFileSync(
      logPath,
      `${new Date().toISOString()} ${stage}${details ? ` ${details}` : ""}\n`,
      "utf8",
    );
  } catch {
    // Voice functionality must not depend on diagnostics.
  }
}

function gatewayError(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    typeof payload.detail === "string"
  ) {
    return payload.detail;
  }
  return fallback;
}

async function gatewayPayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return { detail: body };
  }
}

function sendChatEvent(event: IpcMainEvent, payload: ChatStreamEvent) {
  if (!event.sender.isDestroyed()) {
    event.sender.send("chat:event", payload);
  }
}

function sendSpeechEvent(event: IpcMainEvent, payload: SpeechStreamEvent) {
  if (!event.sender.isDestroyed()) {
    event.sender.send("speech:event", payload);
  }
}

function sseData(block: string): string | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data || null;
}

async function resolveShellPermission(
  event: IpcMainEvent,
  requestId: string,
  permission: NonNullable<OpenAIStreamChunk["permission"]>,
) {
  if (
    typeof permission.id !== "string" ||
    typeof permission.command !== "string" ||
    typeof permission.cwd !== "string"
  ) {
    throw new Error("Gateway returned an invalid permission request.");
  }

  const allowed = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      permissionResponses.delete(permission.id as string);
      resolve(false);
    }, 120_000);
    permissionResponses.set(permission.id as string, {
      senderId: event.sender.id,
      resolve,
      timeout,
    });
    if (event.sender.isDestroyed()) {
      clearTimeout(timeout);
      permissionResponses.delete(permission.id as string);
      resolve(false);
      return;
    }
    event.sender.send("permission:request", {
      id: permission.id,
      kind:
        permission.kind === "computer_control"
          ? "computer_control"
          : "shell_command",
      command: permission.command,
      cwd: permission.cwd,
      osIsolated: permission.os_isolated === true,
    });
  });

  if (allowed && permission.kind === "computer_control") {
    startDesktopControlIndicator(requestId);
  }
  if (allowed && permission.kind === "shell_command") {
    try {
      await createWorkspaceCheckpoint(`Before ${permission.command.slice(0, 36)}`);
    } catch {
      // Non-Git workspaces still receive the normal explicit permission gate.
    }
  }

  const response = await fetch(
    `${GATEWAY_BASE_URL}/v1/permissions/${encodeURIComponent(permission.id)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Memo-Desktop": "1",
        "X-Memo-Computer-Tools": "1",
      },
      body: JSON.stringify({ allowed }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // Use the status fallback for non-JSON errors.
    }
    throw new Error(
      gatewayError(payload, `Permission response failed (${response.status}).`),
    );
  }
}

async function emitSseData(
  event: IpcMainEvent,
  requestId: string,
  data: string,
) {
  if (data === "[DONE]") {
    sendChatEvent(event, { id: requestId, type: "done" });
    return true;
  }

  const payload = JSON.parse(data) as OpenAIStreamChunk;
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  if (payload.object === "memo.permission_request") {
    if (!payload.permission) {
      throw new Error("Gateway returned an empty permission request.");
    }
    await resolveShellPermission(event, requestId, payload.permission);
    return false;
  }

  if (payload.object === "memo.tool_call") {
    const toolCall = payload.tool_call;
    if (
      typeof toolCall?.id === "string" &&
      typeof toolCall.name === "string" &&
      toolCall.arguments !== null &&
      typeof toolCall.arguments === "object" &&
      !Array.isArray(toolCall.arguments)
    ) {
      sendChatEvent(event, {
        id: requestId,
        type: "tool-call",
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments as Record<string, unknown>,
          ...("result" in toolCall ? { result: toolCall.result } : {}),
          ...(typeof toolCall.is_error === "boolean"
            ? { isError: toolCall.is_error }
            : {}),
        },
      });
    }
    return false;
  }

  if (
    payload.object === "memo.image" &&
    typeof payload.image?.data === "string" &&
    typeof payload.image.media_type === "string" &&
    payload.image.media_type.startsWith("image/")
  ) {
    sendChatEvent(event, {
      id: requestId,
      type: "image",
      image: `data:${payload.image.media_type};base64,${payload.image.data}`,
      ...(typeof payload.image.model === "string"
        ? { model: payload.image.model }
        : {}),
      ...(typeof payload.image.prompt === "string"
        ? { prompt: payload.image.prompt }
        : {}),
    });
    return false;
  }

  const content = payload.choices?.[0]?.delta?.content;
  if (content) {
    sendChatEvent(event, {
      id: requestId,
      type: "delta",
      content,
    });
  }
  return false;
}

async function streamResponse(
  event: IpcMainEvent,
  requestId: string,
  response: Response,
) {
  if (!response.body) {
    throw new Error("Chat API returned no response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneEventReceived = false;

  try {
    while (!doneEventReceived) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replaceAll("\r\n", "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = sseData(block);
        if (data) {
          doneEventReceived = await emitSseData(event, requestId, data);
          if (doneEventReceived) break;
        }
        boundary = buffer.indexOf("\n\n");
      }

      if (done) break;
    }

    if (!doneEventReceived) {
      const trailingData = sseData(buffer);
      if (trailingData) {
        doneEventReceived = await emitSseData(event, requestId, trailingData);
      }
    }
    if (!doneEventReceived) {
      sendChatEvent(event, { id: requestId, type: "done" });
    }
  } finally {
    if (doneEventReceived) await reader.cancel();
    reader.releaseLock();
  }
}

function isChatContentPart(value: unknown): value is ChatContentPart {
  if (!value || typeof value !== "object") return false;
  const part = value as Partial<ChatContentPart>;

  if (part.type === "text") return typeof part.text === "string";
  if (part.type === "image_url") {
    return (
      !!part.image_url &&
      typeof part.image_url === "object" &&
      typeof part.image_url.url === "string" &&
      part.image_url.url.startsWith("data:image/")
    );
  }
  return (
    part.type === "file" &&
    !!part.file &&
    typeof part.file === "object" &&
    typeof part.file.filename === "string" &&
    typeof part.file.file_data === "string" &&
    part.file.file_data.startsWith("data:")
  );
}

function isChatContent(value: unknown): value is ChatMessage["content"] {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.length > 0 && value.every(isChatContentPart))
  );
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;

  const request = value as Partial<ChatRequest>;
  return (
    typeof request.id === "string" &&
    !!request.agent &&
    typeof request.agent.cli === "string" &&
    typeof request.agent.model === "string" &&
    ["host", "local_vm", "vps"].includes(request.agent.computerTarget) &&
    Array.isArray(request.messages) &&
    request.messages.every(
      (message) =>
        !!message &&
        typeof message === "object" &&
        ["system", "user", "assistant"].includes(message.role) &&
        isChatContent(message.content),
    )
  );
}

export function registerChatApi() {
  traceVoice("ipc.registered");
  ipcMain.on("permission:respond", (event, response: unknown) => {
    if (
      !response ||
      typeof response !== "object" ||
      !("id" in response) ||
      typeof response.id !== "string" ||
      !("allowed" in response) ||
      typeof response.allowed !== "boolean"
    ) {
      return;
    }
    const pending = permissionResponses.get(response.id);
    if (!pending || pending.senderId !== event.sender.id) return;
    clearTimeout(pending.timeout);
    permissionResponses.delete(response.id);
    pending.resolve(response.allowed);
  });
  ipcMain.on("speech:trace", (_event, stage: unknown) => {
    if (typeof stage === "string") traceVoice(`renderer.${stage}`);
  });

  ipcMain.handle("system:health", async () => {
    await ensureGatewayRunning();
    const startedAt = performance.now();
    const response = await fetch(`${GATEWAY_BASE_URL}/health/readiness`, {
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await gatewayPayload(response);
    if (!response.ok || !payload || typeof payload !== "object") {
      throw new Error(
        gatewayError(payload, "Could not inspect provider health."),
      );
    }
    return {
      ...payload,
      latency_ms: Math.round(performance.now() - startedAt),
    };
  });

  ipcMain.handle("auth:open-codex-help", async () => {
    await shell.openExternal("https://developers.openai.com/codex/auth");
    return { opened: true };
  });

  ipcMain.handle("agents:list", async () => {
    await ensureGatewayRunning();
    const response = await fetch(`${GATEWAY_BASE_URL}/v1/agents`);
    const payload = (await response.json()) as { data?: unknown };
    if (!response.ok || !Array.isArray(payload.data)) {
      throw new Error(gatewayError(payload, "Could not load agents."));
    }
    return payload.data;
  });

  ipcMain.handle("agents:backends", async () => {
    await ensureGatewayRunning();
    const response = await fetch(`${GATEWAY_BASE_URL}/v1/cli-backends`);
    const payload = (await response.json()) as { data?: unknown };
    if (!response.ok || !Array.isArray(payload.data)) {
      throw new Error(
        gatewayError(payload, "Could not load AI agent runtimes."),
      );
    }
    return payload.data;
  });

  ipcMain.handle("composio:status", async () => {
    await ensureGatewayRunning();
    const response = await fetch(`${GATEWAY_BASE_URL}/v1/composio/status`);
    const payload = (await response.json()) as { configured?: unknown };
    if (!response.ok || typeof payload.configured !== "boolean") {
      throw new Error(gatewayError(payload, "Could not read Composio status."));
    }
    return { configured: payload.configured };
  });

  ipcMain.handle("composio:toolkits", async (_event, search: unknown) => {
    if (typeof search !== "string" || search.length > 100)
      throw new Error("Invalid app search.");
    await ensureGatewayRunning();
    const query = new URLSearchParams({ search });
    const response = await fetch(
      `${GATEWAY_BASE_URL}/v1/composio/toolkits?${query}`,
    );
    const payload = (await gatewayPayload(response)) as { data?: unknown };
    if (!response.ok || !Array.isArray(payload.data))
      throw new Error(
        gatewayError(payload, "Could not search app integrations."),
      );
    return payload;
  });
  ipcMain.handle("composio:connections", async () => {
    await ensureGatewayRunning();
    const response = await fetch(`${GATEWAY_BASE_URL}/v1/composio/connections`);
    const payload = (await gatewayPayload(response)) as { data?: unknown };
    if (!response.ok || !Array.isArray(payload.data))
      throw new Error(gatewayError(payload, "Could not load app connections."));
    return payload;
  });
  ipcMain.handle(
    "composio:disconnect",
    async (_event, connectionId: unknown) => {
      if (typeof connectionId !== "string" || !connectionId)
        throw new Error("Invalid app connection.");
      await ensureGatewayRunning();
      const response = await fetch(
        `${GATEWAY_BASE_URL}/v1/composio/connections/${encodeURIComponent(connectionId)}`,
        { method: "DELETE" },
      );
      if (!response.ok)
        throw new Error(
          gatewayError(
            await gatewayPayload(response),
            "Could not disconnect the app.",
          ),
        );
    },
  );

  ipcMain.handle("composio:key-status", () => ({
    hasKey: Boolean(getComposioKey()),
  }));
  ipcMain.handle("composio:set-key", async (_event, key: unknown) => {
    if (typeof key !== "string" || !key.trim())
      throw new Error("Enter a Composio API key.");
    setComposioKey(key.trim());
    await restartManagedGateway();
    return { saved: true };
  });
  ipcMain.handle("composio:authorize", async (_event, toolkit: unknown) => {
    if (typeof toolkit !== "string" || !toolkit)
      throw new Error("Invalid toolkit.");
    await ensureGatewayRunning();
    const response = await fetch(
      `${GATEWAY_BASE_URL}/v1/composio/authorize/${encodeURIComponent(toolkit)}`,
      { method: "POST" },
    );
    const payload = (await gatewayPayload(response)) as {
      redirect_url?: unknown;
      detail?: unknown;
    };
    if (!response.ok || typeof payload.redirect_url !== "string")
      throw new Error(
        gatewayError(payload, "Could not start Composio sign in."),
      );
    const url = new URL(payload.redirect_url);
    if (url.protocol !== "https:")
      throw new Error("Composio returned an invalid sign-in URL.");
    await shell.openExternal(url.href);
    return { opened: true };
  });

  ipcMain.handle(
    "agents:create",
    async (_event, request: AgentProfileRequest) => {
      await ensureGatewayRunning();
      const response = await fetch(`${GATEWAY_BASE_URL}/v1/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(gatewayError(payload, "Could not create agent."));
      }
      return payload;
    },
  );

  ipcMain.handle("agents:delete", async (_event, agentId: unknown) => {
    if (typeof agentId !== "string") throw new Error("Invalid agent id.");
    await ensureGatewayRunning();
    const response = await fetch(
      `${GATEWAY_BASE_URL}/v1/agents/${encodeURIComponent(agentId)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        /* status fallback */
      }
      throw new Error(gatewayError(payload, "Could not delete agent."));
    }
  });

  ipcMain.handle(
    "agents:update",
    async (_event, agentId: unknown, changes: unknown) => {
      if (typeof agentId !== "string") throw new Error("Invalid agent id.");
      await ensureGatewayRunning();
      const response = await fetch(
        `${GATEWAY_BASE_URL}/v1/agents/${encodeURIComponent(agentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        },
      );
      const payload = await gatewayPayload(response);
      if (!response.ok) {
        throw new Error(gatewayError(payload, "Could not update agent."));
      }
      return payload;
    },
  );

  ipcMain.handle("speech:prepare", async () => {
    traceVoice("prepare.received");
    try {
      await ensureGatewayRunning();
      const response = await fetch(
        `${GATEWAY_BASE_URL}/v1/audio/transcriptions/prepare`,
        {
          method: "POST",
          headers: {
            "X-Memo-Desktop": "1",
          },
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          // Use the status fallback for non-JSON errors.
        }
        throw new Error(
          gatewayError(
            payload,
            `Speech preparation failed (${response.status}).`,
          ),
        );
      }
      traceVoice("prepare.ready");
      return { ready: true };
    } catch (error) {
      traceVoice(
        "prepare.error",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  });

  ipcMain.handle("speech:transcribe", async (_event, request: unknown) => {
    traceVoice("transcribe.received");
    if (
      !request ||
      typeof request !== "object" ||
      !("audio" in request) ||
      typeof request.audio !== "string" ||
      !("mimeType" in request) ||
      typeof request.mimeType !== "string" ||
      !("filename" in request) ||
      typeof request.filename !== "string"
    ) {
      throw new Error("Invalid speech transcription request.");
    }

    const speech = request as SpeechTranscriptionRequest;
    traceVoice(
      "transcribe.validated",
      `base64_chars=${speech.audio.length} mime=${speech.mimeType}`,
    );
    const form = new FormData();
    form.set(
      "file",
      new Blob([Buffer.from(speech.audio, "base64")], {
        type: speech.mimeType || "audio/webm",
      }),
      speech.filename || "recording.webm",
    );
    form.set("model", "ink-whisper");

    await ensureGatewayRunning();
    traceVoice("transcribe.gateway-ready");
    const response = await fetch(
      `${GATEWAY_BASE_URL}/v1/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          "X-Memo-Desktop": "1",
        },
        body: form,
        signal: AbortSignal.timeout(120_000),
      },
    );
    traceVoice("transcribe.response", `status=${response.status}`);
    const payload = (await response.json()) as { text?: unknown };
    if (!response.ok) {
      throw new Error(
        gatewayError(
          payload,
          `Speech transcription failed (${response.status}).`,
        ),
      );
    }
    if (typeof payload.text !== "string") {
      throw new Error("Gateway returned an invalid transcription.");
    }
    return { text: payload.text };
  });

  ipcMain.on("speech:stream", (event, request: unknown) => {
    if (
      !request ||
      typeof request !== "object" ||
      !("id" in request) ||
      typeof request.id !== "string" ||
      !("text" in request) ||
      typeof request.text !== "string"
    ) {
      return;
    }

    const id = request.id;
    speechControllers.get(id)?.abort();
    const controller = new AbortController();
    speechControllers.set(id, controller);

    void (async () => {
      try {
        await ensureGatewayRunning();
        const response = await fetch(`${GATEWAY_BASE_URL}/v1/audio/speech`, {
          method: "POST",
          headers: {
            Accept: "audio/wav",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "pocket-tts",
            voice: "alba",
            input: request.text,
            response_format: "wav",
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            // Use the status fallback below for non-JSON responses.
          }
          throw new Error(
            gatewayError(
              payload,
              `Speech synthesis failed (${response.status}).`,
            ),
          );
        }
        if (!response.body) {
          throw new Error("Speech API returned no audio stream.");
        }

        const reader = response.body.getReader();
        try {
          let streamEnded = false;
          while (!streamEnded) {
            const { value, done } = await reader.read();
            streamEnded = done;
            if (value?.byteLength) {
              sendSpeechEvent(event, {
                id,
                type: "chunk",
                audio: Buffer.from(value).toString("base64"),
              });
            }
          }
        } finally {
          reader.releaseLock();
        }
        sendSpeechEvent(event, { id, type: "done" });
      } catch (error) {
        if (controller.signal.aborted) {
          sendSpeechEvent(event, { id, type: "done" });
        } else {
          sendSpeechEvent(event, {
            id,
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (speechControllers.get(id) === controller) {
          speechControllers.delete(id);
        }
      }
    })();
  });

  ipcMain.on("speech:cancel", (_event, requestId: unknown) => {
    if (typeof requestId === "string") {
      speechControllers.get(requestId)?.abort();
    }
  });

  ipcMain.on("chat:stream", (event, request: unknown) => {
    if (!isChatRequest(request)) {
      const id =
        request &&
        typeof request === "object" &&
        "id" in request &&
        typeof request.id === "string"
          ? request.id
          : "";
      sendChatEvent(event, {
        id,
        type: "error",
        message: "Invalid chat request.",
      });
      return;
    }

    controllers.get(request.id)?.abort();
    const controller = new AbortController();
    controllers.set(request.id, controller);

    void (async () => {
      try {
        await ensureGatewayRunning();
        const requestChat = () =>
          fetch(`${GATEWAY_BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers: {
              Accept: "text/event-stream",
              "Content-Type": "application/json",
              "X-Memo-Desktop": "1",
              "X-Memo-Computer-Tools": "1",
            },
            body: JSON.stringify({
              model: "codex",
              memo_agent: request.agent,
              messages: request.messages,
              stream: true,
            }),
            signal: controller.signal,
          });

        let response = await requestChat();
        if (response.status === 502 && !controller.signal.aborted) {
          await response.body?.cancel();
          await new Promise<void>((resolve) => setTimeout(resolve, 350));
          response = await requestChat();
        }

        if (!response.ok) {
          const payload = (await response.json()) as unknown;
          throw new Error(
            gatewayError(
              payload,
              `Chat API request failed (${response.status}).`,
            ),
          );
        }

        await streamResponse(event, request.id, response);
      } catch (error) {
        if (controller.signal.aborted) {
          sendChatEvent(event, { id: request.id, type: "done" });
        } else {
          sendChatEvent(event, {
            id: request.id,
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        stopDesktopControlIndicator(request.id);
        if (controllers.get(request.id) === controller) {
          controllers.delete(request.id);
        }
      }
    })();
  });

  ipcMain.on("chat:cancel", (_event, requestId: unknown) => {
    if (typeof requestId === "string") {
      controllers.get(requestId)?.abort();
    }
  });
}
