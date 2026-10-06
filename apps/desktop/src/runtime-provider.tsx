import { useMemo, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  type AttachmentAdapter,
  type ChatModelAdapter,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  type ThreadAssistantMessagePart,
  type ThreadUserMessagePart,
  type ToolCallMessagePart,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import type { ReadonlyJSONObject } from "assistant-stream/utils";
import {
  createLocalStorageAdapter,
  createSimpleTitleAdapter,
} from "@assistant-ui/core/react";
import { gatewaySpeechAdapter } from "@/lib/gateway-speech-adapter";
import { nativeSpeechDictationAdapter } from "@/lib/native-speech-dictation";
import { agentSystemPrompt } from "@/agents/agent-personality";
import { useAgents } from "@/agents/agent-provider";
import type { AgentProfile } from "@/agents/agent-provider";

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });

const documentAttachmentAdapter: AttachmentAdapter = {
  accept:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx",
  async add({ file }) {
    return {
      id: crypto.randomUUID(),
      type: "document",
      name: file.name,
      contentType: file.type,
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  },
  async send(attachment) {
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          mimeType: attachment.contentType || "application/octet-stream",
          data: await fileToDataUrl(attachment.file),
        },
      ],
    };
  },
  async remove() {},
};

const imageAttachmentAdapter = new SimpleImageAttachmentAdapter();
imageAttachmentAdapter.accept = "image/*,.png,.jpg,.jpeg,.jfif,.webp,.gif";

const textAttachmentAdapter = new SimpleTextAttachmentAdapter();
textAttachmentAdapter.accept =
  "text/plain,text/html,text/markdown,text/csv,text/xml,text/json,application/json,text/css,.txt,.md,.markdown,.csv,.json,.html,.htm,.xml,.css";

const attachmentAdapter = new CompositeAttachmentAdapter([
  imageAttachmentAdapter,
  textAttachmentAdapter,
  documentAttachmentAdapter,
]);

const threadListAdapter = createLocalStorageAdapter({
  storage: {
    getItem: async (key) => {
      const stored = await window.desktopApi.chatHistory.getItem(key);
      if (stored !== null) return stored;

      // Migrate a previously saved localStorage entry the first time it is read.
      const legacy = window.localStorage.getItem(key);
      if (legacy !== null) {
        await window.desktopApi.chatHistory.setItem(key, legacy);
        window.localStorage.removeItem(key);
      }
      return legacy;
    },
    setItem: async (key, value) => {
      await window.desktopApi.chatHistory.setItem(key, value);
      window.localStorage.removeItem(key);
    },
    removeItem: async (key) => {
      await window.desktopApi.chatHistory.removeItem(key);
      window.localStorage.removeItem(key);
    },
  },
  prefix: "memo",
  titleGenerator: createSimpleTitleAdapter(),
});

type DesktopContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | {
      type: "file";
      file: { filename: string; file_data: string };
    };

const appendModelPart = (
  content: DesktopContentPart[],
  part: ThreadUserMessagePart | ThreadAssistantMessagePart,
) => {
  if (part.type === "text") {
    if (part.text) content.push({ type: "text", text: part.text });
  } else if (part.type === "image") {
    content.push({
      type: "image_url",
      image_url: { url: part.image },
    });
  } else if (part.type === "file") {
    content.push({
      type: "file",
      file: {
        filename: part.filename ?? "attachment",
        file_data: part.data,
      },
    });
  }
};

const createModelAdapter = (agent: AgentProfile): ChatModelAdapter => ({
  async *run({ messages, abortSignal }) {
    const requestId = crypto.randomUUID();
    const request = {
      id: requestId,
      agent: {
        cli: agent.cli,
        model: agent.model,
        composioEnabled: agent.composioEnabled,
        composioUserId: agent.composioUserId,
        composioToolkits: agent.composioToolkits,
      },
      messages: [
        { role: "system" as const, content: agentSystemPrompt(agent) },
        ...messages
        .map((message) => {
          const content: DesktopContentPart[] = [];
          for (const part of message.content) {
            appendModelPart(content, part);
          }
          if (message.role === "user") {
            for (const attachment of message.attachments) {
              for (const part of attachment.content) {
                appendModelPart(content, part);
              }
            }
          }

          const hasAttachment = content.some((part) => part.type !== "text");
          return {
            role: message.role,
            content: hasAttachment
              ? content
              : content
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n"),
          };
        })
        .filter((message) => message.content.length > 0),
      ],
    };

    const events: ChatStreamEvent[] = [];
    let wake: (() => void) | undefined;
    let streamClosed = false;
    const enqueue = (event: ChatStreamEvent) => {
      if (streamClosed) return;
      events.push(event);
      wake?.();
      wake = undefined;
    };
    const nextEvent = async () => {
      if (events.length > 0) return events.shift()!;
      if (abortSignal.aborted) {
        return { id: requestId, type: "done" } satisfies ChatStreamEvent;
      }
      return await new Promise<ChatStreamEvent>((resolve, reject) => {
        const onAbort = () => {
          abortSignal.removeEventListener("abort", onAbort);
          resolve({ id: requestId, type: "done" });
        };
        abortSignal.addEventListener("abort", onAbort, { once: true });
        wake = () => {
          abortSignal.removeEventListener("abort", onAbort);
          const event = events.shift();
          if (event) resolve(event);
          else reject(new Error("Chat stream woke without an event."));
        };
      });
    };

    const unsubscribe = window.desktopApi.streamChat(request, enqueue);

    const cancel = () => {
      window.desktopApi.cancelChat(requestId);
      enqueue({ id: requestId, type: "done" });
    };
    abortSignal.addEventListener("abort", cancel, { once: true });

    const content: ThreadAssistantMessagePart[] = [];
    const toolPartIndexes = new Map<string, number>();
    let textPartIndex: number | undefined;
    let text = "";
    try {
      while (!abortSignal.aborted) {
        const event = await nextEvent();
        if (event.type === "delta") {
          text += event.content;
          const textPart = { type: "text" as const, text };
          if (textPartIndex === undefined) {
            textPartIndex = content.length;
            content.push(textPart);
          } else {
            content[textPartIndex] = textPart;
          }
          yield { content: [...content] };
        } else if (event.type === "tool-call") {
          const { toolCall } = event;
          const part: ToolCallMessagePart = {
            type: "tool-call",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments as ReadonlyJSONObject,
            argsText: JSON.stringify(toolCall.arguments),
            ...("result" in toolCall ? { result: toolCall.result } : {}),
            ...(toolCall.isError !== undefined
              ? { isError: toolCall.isError }
              : {}),
          };
          const index = toolPartIndexes.get(toolCall.id);
          if (index === undefined) {
            toolPartIndexes.set(toolCall.id, content.length);
            content.push(part);
          } else {
            content[index] = part;
          }
          yield { content: [...content] };
        } else if (event.type === "image") {
          content.push({
            type: "image",
            image: event.image,
          });
          yield { content: [...content] };
        } else if (event.type === "error") {
          throw new Error(event.message);
        } else if (event.type === "done") {
          break;
        } else {
          break;
        }
      }
    } finally {
      streamClosed = true;
      wake = undefined;
      abortSignal.removeEventListener("abort", cancel);
      unsubscribe();
    }
  },
});

export function RuntimeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { activeAgent } = useAgents();
  const modelAdapter = useMemo(
    () => createModelAdapter(activeAgent),
    [activeAgent],
  );
  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook: () =>
      useLocalRuntime(modelAdapter, {
        adapters: {
          attachments: attachmentAdapter,
          dictation: nativeSpeechDictationAdapter,
          speech: gatewaySpeechAdapter,
        },
      }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
