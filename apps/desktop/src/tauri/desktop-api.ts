const GATEWAY = "http://127.0.0.1:4010";
const chatControllers = new Map<string, AbortController>();
const speechControllers = new Map<string, AbortController>();
const permissionListeners = new Set<(request: PermissionRequest) => void>();
const permissionResolvers = new Map<string, (allowed: boolean) => void>();
const NATIVE_CHAT_RUNTIMES = new Set([
  "codex",
  "hermes",
  "antigravity",
  "ollama",
]);

const isTauri = () => "__TAURI_INTERNALS__" in window;

function promptForPermission(request: PermissionRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    permissionResolvers.set(request.id, resolve);
    for (const listener of permissionListeners) listener(request);
  });
}

function isApprovalRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("requires approval") ||
    normalized.includes("approval policy is never") ||
    normalized.includes("permission denied")
  );
}

async function command<T>(name: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(name, args);
}

async function gateway<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      "X-Memo-Desktop": "1",
      "X-Memo-Computer-Tools": "1",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = `Gateway request failed (${response.status}).`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
    } catch {
      // Preserve the status fallback for non-JSON responses.
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function gatewayList<T>(path: string): Promise<T[]> {
  const payload = await gateway<{ data?: unknown }>(path);
  if (!Array.isArray(payload.data)) {
    throw new Error("Gateway returned an invalid list response.");
  }
  return payload.data as T[];
}

function sseData(block: string) {
  const value = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return value || null;
}

async function resolvePermission(
  permission: {
    id?: unknown;
    kind?: unknown;
    command?: unknown;
    cwd?: unknown;
    os_isolated?: unknown;
  },
  mode: "ask" | "auto" | "allow" | "allowlist" | "custom",
) {
  if (
    typeof permission.id !== "string" ||
    typeof permission.command !== "string" ||
    typeof permission.cwd !== "string"
  ) {
    throw new Error("Gateway returned an invalid permission request.");
  }
  const request: PermissionRequest = {
    id: permission.id,
    kind:
      permission.kind === "computer_control"
        ? "computer_control"
        : "shell_command",
    command: permission.command,
    cwd: permission.cwd,
    osIsolated: permission.os_isolated === true,
  };
  const allowed =
    mode === "allow"
      ? true
      : mode === "auto" &&
          (request.kind === "computer_control" || request.osIsolated)
        ? true
        : await promptForPermission(request);
  await gateway(`/v1/permissions/${encodeURIComponent(request.id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowed }),
  });
}

async function emitChatData(
  requestId: string,
  data: string,
  onEvent: (event: ChatStreamEvent) => void,
  permissionMode: "ask" | "auto" | "allow" | "allowlist" | "custom",
) {
  if (data === "[DONE]") {
    onEvent({ id: requestId, type: "done" });
    return true;
  }
  const payload = JSON.parse(data) as {
    object?: string;
    error?: { message?: string };
    permission?: Parameters<typeof resolvePermission>[0];
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
    choices?: Array<{ delta?: { content?: string | null } }>;
  };
  if (payload.error?.message) throw new Error(payload.error.message);
  if (payload.object === "memo.permission_request" && payload.permission) {
    await resolvePermission(payload.permission, permissionMode);
    return false;
  }
  const tool = payload.tool_call;
  if (
    payload.object === "memo.tool_call" &&
    typeof tool?.id === "string" &&
    typeof tool.name === "string" &&
    tool.arguments !== null &&
    typeof tool.arguments === "object" &&
    !Array.isArray(tool.arguments)
  ) {
    onEvent({
      id: requestId,
      type: "tool-call",
      toolCall: {
        id: tool.id,
        name: tool.name,
        arguments: tool.arguments as Record<string, unknown>,
        ...(tool.result !== undefined ? { result: tool.result } : {}),
        ...(typeof tool.is_error === "boolean"
          ? { isError: tool.is_error }
          : {}),
      },
    });
    return false;
  }
  if (
    payload.object === "memo.image" &&
    typeof payload.image?.data === "string" &&
    typeof payload.image.media_type === "string"
  ) {
    onEvent({
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
  if (content) onEvent({ id: requestId, type: "delta", content });
  return false;
}

async function readChatStream(
  requestId: string,
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
  permissionMode: "ask" | "auto" | "allow" | "allowlist" | "custom",
) {
  if (!response.body) throw new Error("Chat API returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const data = sseData(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (data) {
        finished = await emitChatData(requestId, data, onEvent, permissionMode);
      }
      if (finished) break;
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (!finished) {
    const trailing = sseData(buffer);
    if (trailing) {
      finished = await emitChatData(
        requestId,
        trailing,
        onEvent,
        permissionMode,
      );
    }
  }
  if (!finished) onEvent({ id: requestId, type: "done" });
}

function cliPrompt(
  messages: Parameters<Window["desktopApi"]["streamChat"]>[0]["messages"],
) {
  return messages
    .map((message) => {
      const content =
        typeof message.content === "string"
          ? message.content
          : message.content
              .map((part) => {
                if (part.type === "text") return part.text;
                if (part.type === "image_url") return "[Image attachment]";
                return `[File attachment: ${part.file.filename}]`;
              })
              .join("\n");
      return `${message.role.toUpperCase()}:\n${content}`;
    })
    .join("\n\n");
}

const unsupportedVirtualDesktop = async (): Promise<never> => {
  throw new Error(
    "Virtual desktop setup is not available in this Tauri build yet.",
  );
};

export function installTauriDesktopApi() {
  if (window.desktopApi || !isTauri()) return;

  const platform: NodeJS.Platform = navigator.userAgent.includes("Windows")
    ? "win32"
    : navigator.userAgent.includes("Mac")
      ? "darwin"
      : "linux";

  window.desktopApi = {
    platform,
    windowControls: {
      minimize: () => void command("minimize"),
      toggleMaximize: () => void command("toggle_maximize"),
      close: () => void command("close"),
    },
    streamChat: (request, onEvent) => {
      const controller = new AbortController();
      chatControllers.get(request.id)?.abort();
      chatControllers.set(request.id, controller);
      if (NATIVE_CHAT_RUNTIMES.has(request.agent.cli)) {
        const runNativeChat = (permissionMode: typeof request.permissionMode) =>
          command<string>("runtime_chat", {
            runtime: request.agent.cli,
            model: request.agent.model,
            prompt: cliPrompt(request.messages),
            permissionMode,
          });
        const requestApprovalAndRetry = async () => {
          const permissionId = `native-${request.id}`;
          const allowed = await promptForPermission({
            id: permissionId,
            kind: "computer_control",
            command: "Allow Memo tools for this response",
            cwd: ".",
            osIsolated: true,
          });
          if (!allowed) {
            throw new Error(
              "Permission denied. No computer action was performed.",
            );
          }
          if (controller.signal.aborted) {
            throw new DOMException("Chat cancelled", "AbortError");
          }
          return runNativeChat("auto");
        };
        void (async () => {
          try {
            const content = await runNativeChat(request.permissionMode);
            if (
              request.permissionMode === "ask" &&
              isApprovalRequiredError(content) &&
              !controller.signal.aborted
            ) {
              return requestApprovalAndRetry();
            }
            return content;
          } catch (error) {
            if (
              request.permissionMode === "ask" &&
              isApprovalRequiredError(error) &&
              !controller.signal.aborted
            ) {
              return requestApprovalAndRetry();
            }
            throw error;
          }
        })()
          .then((content) => {
            if (!controller.signal.aborted) {
              onEvent({ id: request.id, type: "delta", content });
              onEvent({ id: request.id, type: "done" });
            }
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) {
              onEvent({ id: request.id, type: "done" });
            } else {
              onEvent({
                id: request.id,
                type: "error",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })
          .finally(() => chatControllers.delete(request.id));
        return () => controller.abort();
      }
      void fetch(`${GATEWAY}/v1/chat/completions`, {
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
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(`Chat API request failed (${response.status}).`);
          await readChatStream(
            request.id,
            response,
            onEvent,
            request.permissionMode,
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted)
            onEvent({ id: request.id, type: "done" });
          else
            onEvent({
              id: request.id,
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            });
        })
        .finally(() => chatControllers.delete(request.id));
      return () => controller.abort();
    },
    cancelChat: (requestId) => chatControllers.get(requestId)?.abort(),
    agents: {
      list: () => gatewayList<AgentProfileData>("/v1/agents"),
      backends: () => command<AgentBackendData[]>("runtime_list"),
      create: (agent) =>
        gateway("/v1/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(agent),
        }),
      delete: (agentId) =>
        gateway(`/v1/agents/${encodeURIComponent(agentId)}`, {
          method: "DELETE",
        }),
      update: (agentId, changes) =>
        gateway(`/v1/agents/${encodeURIComponent(agentId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        }),
    },
    onPermissionRequest: (listener) => {
      permissionListeners.add(listener);
      return () => permissionListeners.delete(listener);
    },
    respondPermission: ({ id, allowed }) => {
      permissionResolvers.get(id)?.(allowed);
      permissionResolvers.delete(id);
    },
    getGatewayStatus: () => command("gateway_status"),
    restartGateway: () => command("restart_gateway"),
    getSystemHealth: () => gateway("/health/readiness"),
    openCodexHelp: async () => ({ opened: true }),
    virtualDesktop: {
      get: async () => ({
        reachable: false,
        latencyMs: null,
        message: "Tauri virtual desktop bridge pending",
        endpoint: "",
        hasToken: false,
        containerEngine: null,
      }),
      save: unsupportedVirtualDesktop,
      start: unsupportedVirtualDesktop,
      stop: unsupportedVirtualDesktop,
      open: unsupportedVirtualDesktop,
      preview: unsupportedVirtualDesktop,
      setupVps: unsupportedVirtualDesktop,
    },
    workspace: {
      get: () => command("workspace_get"),
      choose: () => command("workspace_choose"),
      checkpoint: (label) => command("workspace_checkpoint", { label }),
    },
    resources: {
      get: () => command("resource_get"),
      set: (mode) => command("resource_set", { mode }),
    },
    getComposioStatus: () => gateway("/v1/composio/status"),
    getComposioToolkits: (search = "") =>
      gateway(`/v1/composio/toolkits?search=${encodeURIComponent(search)}`),
    getComposioConnections: () => gateway("/v1/composio/connections"),
    disconnectComposio: (connectionId) =>
      gateway(`/v1/composio/connections/${encodeURIComponent(connectionId)}`, {
        method: "DELETE",
      }),
    authorizeComposio: async (toolkit) => {
      const result = await gateway<{ redirect_url: string }>(
        `/v1/composio/authorize/${encodeURIComponent(toolkit)}`,
        { method: "POST" },
      );
      await command("open_external", { url: result.redirect_url });
      return { opened: true };
    },
    traceSpeech: () => undefined,
    prepareSpeech: () =>
      gateway("/v1/audio/transcriptions/prepare", { method: "POST" }),
    transcribeSpeech: ({ audio, mimeType, filename }) => {
      const bytes = Uint8Array.from(
        atob(audio.split(",").at(-1) ?? ""),
        (value) => value.charCodeAt(0),
      );
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: mimeType }), filename);
      return gateway("/v1/audio/transcriptions", {
        method: "POST",
        body: form,
      });
    },
    streamSpeech: (request, onEvent) => {
      const controller = new AbortController();
      speechControllers.set(request.id, controller);
      void fetch(`${GATEWAY}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: request.text }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(`Speech request failed (${response.status}).`);
          const audio = btoa(
            String.fromCharCode(
              ...new Uint8Array(await response.arrayBuffer()),
            ),
          );
          onEvent({ id: request.id, type: "chunk", audio });
          onEvent({ id: request.id, type: "done" });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            onEvent({
              id: request.id,
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            });
        })
        .finally(() => speechControllers.delete(request.id));
      return () => controller.abort();
    },
    cancelSpeech: (requestId) => speechControllers.get(requestId)?.abort(),
    chatHistory: {
      getItem: (key) => command<string | null>("chat_history_get", { key }),
      setItem: (key, value) =>
        command<void>("chat_history_set", { key, value }),
      removeItem: (key) => command<void>("chat_history_remove", { key }),
    },
    permissionMode: {
      get: () =>
        command<"ask" | "auto" | "allow" | "allowlist" | "custom">(
          "permission_mode_get",
        ),
      set: (mode) => command<void>("permission_mode_set", { mode }),
    },
  };
}
