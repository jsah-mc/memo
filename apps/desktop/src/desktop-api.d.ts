export {};

declare global {
  interface Window {
    desktopApi: {
      platform: NodeJS.Platform;
      windowControls: {
        minimize(): void;
        toggleMaximize(): void;
        close(): void;
      };
      streamChat(
        request: {
          id: string;
          agent: {
            cli: string;
            model: string;
            composioEnabled: boolean;
            composioUserId: string;
            composioToolkits: readonly string[];
            computerTarget: "host" | "local_vm" | "vps";
          };
          permissionMode: "ask" | "auto" | "allow" | "allowlist" | "custom";
          messages: Array<{
            role: "system" | "user" | "assistant";
            content:
              | string
              | Array<
                  | { type: "text"; text: string }
                  | { type: "image_url"; image_url: { url: string } }
                  | {
                      type: "file";
                      file: { filename: string; file_data: string };
                    }
                >;
          }>;
        },
        onEvent: (event: ChatStreamEvent) => void,
      ): () => void;
      cancelChat(requestId: string): void;
      agents: {
        list(): Promise<AgentProfileData[]>;
        backends(): Promise<AgentBackendData[]>;
        create(agent: NewAgentData): Promise<AgentProfileData>;
        delete(agentId: string): Promise<void>;
        update(
          agentId: string,
          changes: {
            computerTarget?: "host" | "local_vm" | "vps";
            cli?: string;
            model?: string;
          },
        ): Promise<AgentProfileData>;
      };
      onPermissionRequest(
        onRequest: (request: PermissionRequest) => void,
      ): () => void;
      respondPermission(response: { id: string; allowed: boolean }): void;
      restartGateway(): Promise<void>;
      virtualDesktop: {
        get(target?: "local_vm" | "vps"): Promise<VirtualDesktopStatus>;
        save(settings: {
          target?: "local_vm" | "vps";
          endpoint: string;
          token?: string;
        }): Promise<{ saved: true }>;
        start(): Promise<VirtualDesktopProbe>;
        stop(): Promise<{
          stopped: true;
          containerEngine: "podman" | "docker";
        }>;
        open(target?: "local_vm" | "vps"): Promise<{ opened: true }>;
        preview(target?: "local_vm" | "vps"): Promise<{ image: string }>;
        setupVps(settings: {
          host: string;
          user: string;
          port: number;
          identityFile?: string;
        }): Promise<VirtualDesktopProbe>;
      };
      workspace: {
        get(): Promise<WorkspaceStatus>;
        choose(): Promise<WorkspaceStatus>;
        checkpoint(label: string): Promise<{
          id: string;
          path: string;
          changes: number;
          untrackedFiles: number;
        }>;
      };
      resources: {
        get(): Promise<{ mode: ResourceMode }>;
        set(mode: ResourceMode): Promise<{ mode: ResourceMode }>;
      };
      getGatewayStatus(): Promise<{
        state: "connecting" | "online" | "offline" | "error";
        running: boolean;
        latencyMs: number | null;
        message?: string;
      }>;
      getSystemHealth(): Promise<{
        status: "ok" | "degraded";
        gateway: { status: string; api_version: number };
        provider: {
          id: string;
          status: "ready" | "expired" | "missing" | "invalid";
          message: string;
          expires_at: number | null;
        };
        latency_ms: number;
      }>;
      openCodexHelp(): Promise<{ opened: true }>;
      getComposioStatus(): Promise<{ configured: boolean }>;
      getComposioToolkits(search?: string): Promise<{
        data: Array<{ id: string; label: string; icon?: string }>;
      }>;
      getComposioConnections(): Promise<{ data: ComposioConnection[] }>;
      disconnectComposio(connectionId: string): Promise<void>;
      authorizeComposio(toolkit: string): Promise<{ opened: true }>;
      traceSpeech(stage: string): void;
      prepareSpeech(): Promise<{ ready: true }>;
      transcribeSpeech(request: {
        audio: string;
        mimeType: string;
        filename: string;
      }): Promise<{ text: string }>;
      streamSpeech(
        request: { id: string; text: string },
        onEvent: (event: SpeechStreamEvent) => void,
      ): () => void;
      cancelSpeech(requestId: string): void;
      chatHistory: {
        getItem(key: string): Promise<string | null>;
        setItem(key: string, value: string): Promise<void>;
        removeItem(key: string): Promise<void>;
      };
      permissionMode: {
        get(): Promise<"ask" | "auto" | "allow" | "allowlist" | "custom">;
        set(
          mode: "ask" | "auto" | "allow" | "allowlist" | "custom",
        ): Promise<void>;
      };
    };
  }

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

  type ComposioConnection = { id: string; toolkit: string; status: string };

  type VirtualDesktopProbe = {
    reachable: boolean;
    latencyMs: number | null;
    message: string;
    containerEngine?: "podman" | "docker" | null;
  };
  type VirtualDesktopStatus = VirtualDesktopProbe & {
    endpoint: string;
    hasToken: boolean;
    containerEngine: "podman" | "docker" | null;
    host?: string;
    user?: string;
    port?: number;
    identityFile?: string;
  };
  type ResourceMode = "low" | "balanced" | "performance";
  type WorkspaceStatus = {
    path: string;
    name: string;
    git: boolean;
    changes: number;
  };

  type NewAgentData = {
    name: string;
    role: string;
    instructions: string;
    description: string;
    style: string;
    soul: string;
    cli: string;
    model: string;
    color: string;
    composioEnabled: boolean;
    composioUserId: string;
    composioToolkits: readonly string[];
    computerTarget: "host" | "local_vm" | "vps";
  };

  type AgentProfileData = NewAgentData & {
    id: string;
    builtIn?: boolean;
  };

  type AgentBackendData = {
    id: string;
    label: string;
    executable: string;
    modelFlag: string | null;
    nativeToolsPolicy: string;
    defaultModel: string;
    models: string[];
    installed: boolean;
  };

  type PermissionRequest = {
    id: string;
    kind: "computer_control" | "shell_command";
    command: string;
    cwd: string;
    osIsolated: boolean;
  };

  type SpeechStreamEvent =
    | { id: string; type: "chunk"; audio: string }
    | { id: string; type: "done" }
    | { id: string; type: "error"; message: string };
}
