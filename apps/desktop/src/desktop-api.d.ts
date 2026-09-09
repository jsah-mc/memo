export {};

declare global {
  interface Window {
    desktopApi: {
      streamChat(
        request: {
          id: string;
          agent: {
            cli: string;
            model: string;
            composioEnabled: boolean;
            composioUserId: string;
            composioToolkits: readonly string[];
          };
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
        create(agent: NewAgentData): Promise<AgentProfileData>;
        delete(agentId: string): Promise<void>;
      };
      onPermissionRequest(
        onRequest: (request: PermissionRequest) => void,
      ): () => void;
      respondPermission(response: { id: string; allowed: boolean }): void;
      getGatewayStatus(): Promise<{
        state: "connecting" | "online" | "offline" | "error";
        running: boolean;
        latencyMs: number | null;
        message?: string;
      }>;
      getComposioStatus(): Promise<{ configured: boolean }>;
      getComposioKeyStatus(): Promise<{ hasKey: boolean }>;
      setComposioKey(key: string): Promise<{ saved: true }>;
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

  type NewAgentData = {
    name: string;
    role: string;
    instructions: string;
    cli: string;
    model: string;
    color: string;
    composioEnabled: boolean;
    composioUserId: string;
    composioToolkits: readonly string[];
  };

  type AgentProfileData = NewAgentData & {
    id: string;
    builtIn?: boolean;
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
