import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type MessageBoxOptions,
} from "electron";
import { appendFileSync, statSync, truncateSync } from "node:fs";
import path from "node:path";
import {
  ensureGatewayRunning,
  GATEWAY_BASE_URL,
} from "./gateway-process";

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
  messages: ChatMessage[];
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
  permission: NonNullable<OpenAIStreamChunk["permission"]>,
) {
  if (
    typeof permission.id !== "string" ||
    typeof permission.command !== "string" ||
    typeof permission.cwd !== "string"
  ) {
    throw new Error("Gateway returned an invalid permission request.");
  }

  const isComputerControl = permission.kind === "computer_control";
  const options: MessageBoxOptions = {
    type: "warning",
    title: isComputerControl
      ? "Memo computer control"
      : "Memo shell permission",
    message: isComputerControl
      ? "Allow Memo to view and control the computer for this task?"
      : "Allow Memo to run this shell command?",
    detail: isComputerControl
      ? [
          "Memo may capture your visible screens and send screenshots to the configured AI model.",
          "It may click, type, press keys, and scroll until this response finishes.",
          "",
          "This approval applies only to the current task and is not remembered.",
        ].join("\n")
      : [
          "Command:",
          permission.command,
          "",
          "Working directory:",
          permission.cwd,
          "",
          "This runs on your Windows host and is not OS-isolated.",
        ].join("\n"),
    buttons: ["Deny", "Allow once"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const owner = BrowserWindow.fromWebContents(event.sender);
  const choice = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options);
  const allowed = choice.response === 1;

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
      gatewayError(
        payload,
        `Permission response failed (${response.status}).`,
      ),
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
    await resolveShellPermission(event, payload.permission);
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
        doneEventReceived = await emitSseData(
          event,
          requestId,
          trailingData,
        );
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
  ipcMain.on("speech:trace", (_event, stage: unknown) => {
    if (typeof stage === "string") traceVoice(`renderer.${stage}`);
  });

  ipcMain.handle("speech:prepare", async () => {
    traceVoice("prepare.received");
    try {
      await ensureGatewayRunning();
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
        const response = await fetch(
          `${GATEWAY_BASE_URL}/v1/audio/speech`,
          {
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
          },
        );
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
