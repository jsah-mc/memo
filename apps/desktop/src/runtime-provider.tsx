import { useMemo, useRef, type ReactNode } from "react";
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
import { setAgentActivity } from "@/agents/agent-activity";
import { useTaskActivity } from "@/agents/task-activity";
import {
  threadModelKey,
  useThreadModels,
} from "@/agents/thread-model-provider";
import { botSystemPrompt, getBotSettings } from "@/agents/bot-settings";
import { useAgentGroups } from "@/agents/agent-groups";

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

const createThreadListAdapter = (scope: string, migrateLegacy = false) =>
  createLocalStorageAdapter({
    storage: {
    getItem: async (key) => {
      const stored = await window.desktopApi.chatHistory.getItem(key);
      if (stored !== null) return stored;

      if (migrateLegacy) {
        const legacyKey = key.replace(/^memo\.agent\.memo/, "memo");
        const legacyStored = await window.desktopApi.chatHistory.getItem(legacyKey);
        if (legacyStored !== null) {
          await window.desktopApi.chatHistory.setItem(key, legacyStored);
          return legacyStored;
        }
        const legacyLocal = window.localStorage.getItem(legacyKey);
        if (legacyLocal !== null) {
          await window.desktopApi.chatHistory.setItem(key, legacyLocal);
          window.localStorage.removeItem(legacyKey);
          return legacyLocal;
        }
      }

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
    prefix: `memo.${scope}`,
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

const createModelAdapter = (
  agent: AgentProfile,
  collaborationContext = "",
): ChatModelAdapter => ({
  async *run({ messages, abortSignal }) {
    setAgentActivity(agent.id, "loading");
    const requestId = crypto.randomUUID();
    const activity = useTaskActivity.getState();
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const titlePart = lastUserMessage?.content.find(
      (part) => part.type === "text",
    );
    activity.start({
      id: requestId,
      agentId: agent.id,
      title:
        titlePart?.type === "text" ? titlePart.text.slice(0, 80) : "Agent task",
      status: "running",
      startedAt: Date.now(),
      tools: [],
    });
    const botSettings = getBotSettings(agent.id, agent.name);
    const botPrompt = botSystemPrompt(botSettings);
    const botUsesExistingApps = botSettings.allowedComposioApps.includes("*");
    const botComposioApps = botUsesExistingApps
      ? agent.composioToolkits
      : botSettings.allowedComposioApps;
    const request = {
      id: requestId,
      agent: {
        cli: agent.cli,
        model: agent.model,
        composioEnabled: botSettings.enabled
          ? botSettings.allowedTools.includes("integrations") &&
            (botUsesExistingApps
              ? agent.composioEnabled
              : botComposioApps.length > 0)
          : agent.composioEnabled,
        composioUserId: agent.composioUserId,
        composioToolkits: botSettings.enabled
          ? botComposioApps
          : agent.composioToolkits,
        computerTarget: agent.computerTarget,
        allowedTools: botSettings.enabled
          ? botSettings.allowedTools
          : undefined,
        permissionMode: botSettings.enabled
          ? botSettings.permissionMode
          : "always_ask",
        allowedComposioTools: botSettings.enabled
          ? botSettings.allowedComposioTools
          : ["*"],
        allowedMcpServers: botSettings.enabled
          ? botSettings.allowedMcpServers
          : [],
      },
      messages: [
        {
          role: "system" as const,
          content: [agentSystemPrompt(agent), botPrompt]
            .concat(collaborationContext)
            .filter(Boolean)
            .join("\n\n"),
        },
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
                    .flatMap((part) =>
                      part.type === "text" ? [part.text] : [],
                    )
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
          activity.tool(requestId, {
            id: toolCall.id,
            name: toolCall.name,
            status: toolCall.isError
              ? "error"
              : "result" in toolCall
                ? "done"
                : "running",
          });
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
      setAgentActivity(agent.id, abortSignal.aborted ? "idle" : "done");
      activity.finish(requestId, abortSignal.aborted ? "cancelled" : "done");
    } catch (error) {
      setAgentActivity(agent.id, abortSignal.aborted ? "idle" : "error");
      activity.finish(
        requestId,
        abortSignal.aborted ? "cancelled" : "error",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      streamClosed = true;
      wake = undefined;
      abortSignal.removeEventListener("abort", cancel);
      unsubscribe();
    }
  },
});

async function* iterateModelRun(
  adapter: ChatModelAdapter,
  options: Parameters<ChatModelAdapter["run"]>[0],
) {
  const result = adapter.run(options);
  if (Symbol.asyncIterator in result) {
    yield* result;
  } else {
    yield await result;
  }
}

const createGroupModelAdapter = (
  groupName: string,
  members: readonly AgentProfile[],
): ChatModelAdapter => ({
  async *run(options) {
    let combined: ThreadAssistantMessagePart[] = [];
    let transcript = "";
    for (const member of members) {
      if (options.abortSignal.aborted) break;
      const context = [
        `You are collaborating in the agent group "${groupName}". Respond as ${member.name}, from your own role and expertise. Address useful points from the other agents and do not impersonate them.`,
        transcript ? `Earlier agent replies in this turn:\n${transcript}` : "You are the first agent to respond this turn.",
      ].join("\n\n");
      let latest: ThreadAssistantMessagePart[] = [];
      for await (const update of iterateModelRun(
        createModelAdapter(member, context),
        options,
      )) {
        latest = [...update.content];
        yield {
          ...update,
          content: [
            ...combined,
            { type: "text" as const, text: `// ${member.name}\n` },
            ...latest,
          ],
        };
      }
      combined = [
        ...combined,
        { type: "text" as const, text: `// ${member.name}\n` },
        ...latest,
      ];
      const reply = latest
        .filter((part): part is Extract<ThreadAssistantMessagePart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      if (reply) transcript += `${member.name}: ${reply}\n\n`;
    }
  },
});

function RuntimeSession({
  children,
  scope,
  members,
  groupName,
}: Readonly<{
  children: ReactNode;
  scope: string;
  members: readonly AgentProfile[];
  groupName?: string;
}>) {
  const { activeAgent } = useAgents();
  const { activeThreadId, selections } = useThreadModels();
  const saved = selections[threadModelKey(activeAgent.id, activeThreadId)];
  const effectiveAgent = {
    ...activeAgent,
    cli: saved?.cli ?? activeAgent.cli,
    model: saved?.model ?? activeAgent.model,
  };
  const effectiveMembers = groupName ? members : [effectiveAgent];
  const membersRef = useRef(effectiveMembers);
  membersRef.current = effectiveMembers;
  const modelAdapter = useMemo<ChatModelAdapter>(
    () => ({
      run: (options) =>
        groupName
          ? createGroupModelAdapter(groupName, membersRef.current).run(options)
          : createModelAdapter(membersRef.current[0]).run(options),
    }),
    [groupName],
  );
  const adapter = useMemo(
    () => createThreadListAdapter(scope, scope === "agent.memo"),
    [scope],
  );
  const runtime = useRemoteThreadListRuntime({
    adapter,
    runtimeHook: () =>
      useLocalRuntime(modelAdapter, {
        adapters: {
          attachments: attachmentAdapter,
          dictation: nativeSpeechDictationAdapter,
          speech: gatewaySpeechAdapter,
        },
      }),
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function RuntimeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { agents, activeAgent } = useAgents();
  const { activeGroup } = useAgentGroups();
  const members = activeGroup
    ? activeGroup.memberIds.flatMap((id) => agents.filter((agent) => agent.id === id))
    : [activeAgent];
  const scope = activeGroup ? `group.${activeGroup.id}` : `agent.${activeAgent.id}`;

  return (
    <RuntimeSession
      key={scope}
      scope={scope}
      members={members}
      groupName={activeGroup?.name}
    >
      {children}
    </RuntimeSession>
  );
}
