import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import {
  BOT_TOOL_IDS,
  botPrompt,
  CODEX_MODELS,
  PROVIDER_MODELS,
  findBot,
  loadBots,
  loadModel,
  newBotEntry,
  saveModel,
  upsertBot,
  type Bot,
} from "./bots";
import {
  authorizeComposioToolkit,
  checkGateway,
  createAgent,
  fetchModelCatalog,
  listComposioConnections,
  listComposioToolkits,
  openExternalUrl,
  resolvePermission,
  streamResponse,
  type AgentConfig,
  type ComposioConnection,
  type InputItem,
  type PermissionRequest,
} from "./gateway";
import { loadSystemPrompt } from "./systemPrompt";
import { ensureGateway } from "./gatewayProcess";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/Messages";
import { PermissionPrompt } from "./components/PermissionPrompt";
import { BotSetup } from "./components/BotSetup";
import { ModelPicker } from "./components/ModelPicker";
import { Composer } from "./components/Composer";
import { CompletionMenu } from "./components/CompletionMenu";
import { SettingsPanel } from "./components/SettingsPanel";
import { loadSettings, saveSettings, type TuiSettings } from "./settings";
import {
  commandCompletions,
  fileCompletions,
  fileQuery,
  slashQuery,
  type CompletionItem,
} from "./completions";
import {
  visibleSidebarEntries,
  type ChatMessage,
} from "./types";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const IDLE = {
  face: ":P",
  detail: "ready · tab bots · /help · /quit",
};

const HELP = [
  "commands:",
  "  /bot set \"name\"  switch bot        /bot create   new bot",
  "  /bot \"name\"      switch bot        /bots         list bots",
  "  /model [name]      pick model        /setup        create a bot",
  "  /apps [connect x]   manage app logins /login <app>  connect an app",
  "  /clear             clear chat        /status       show status",
  "  /retry             resend last       /quit         exit",
].join("\n");

let nextId = 0;
const newId = () => `m${(nextId += 1)}`;

function toolDetail(argumentsValue: unknown): string | undefined {
  if (!argumentsValue || typeof argumentsValue !== "object") return undefined;
  const record = argumentsValue as Record<string, unknown>;
  for (const key of ["command", "task", "app", "url", "query"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      const text = value.trim();
      return text.length > 100 ? `${text.slice(0, 97)}…` : text;
    }
  }
  const json = JSON.stringify(argumentsValue);
  if (!json || json === "{}") return undefined;
  return json.length > 100 ? `${json.slice(0, 97)}…` : json;
}

function connectionToolkit(connection: ComposioConnection): string {
  const toolkit = connection.toolkit;
  if (typeof toolkit === "string") return toolkit;
  if (toolkit && typeof toolkit === "object") {
    const record = toolkit as Record<string, unknown>;
    for (const key of ["slug", "name", "id"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return typeof connection.name === "string" ? connection.name : "";
}

function toolError(call: Record<string, unknown>): string | undefined {
  if (!call.is_error) return undefined;
  const result = call.result;
  if (result && typeof result === "object") {
    const error = (result as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) {
      const text = error.trim();
      return text.length > 100 ? `${text.slice(0, 97)}…` : text;
    }
  }
  return "tool call failed";
}

export default function App() {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const basePrompt = useRef(loadSystemPrompt()).current;

  const [bots, setBots] = useState<Bot[]>(() => loadBots());
  const [activeBotName, setActiveBotName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(IDLE);
  const [gatewayOk, setGatewayOk] = useState<boolean | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<"composer" | "list" | "model">("composer");
  const [cursor, setCursor] = useState(0);
  const [model, setModel] = useState(() => loadModel());
  const [modelCursor, setModelCursor] = useState(0);
  const [pendingPermission, setPendingPermission] =
    useState<PermissionRequest | null>(null);
  const [controlling, setControlling] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [connectedApps, setConnectedApps] = useState<string[]>([]);
  const [completionItems, setCompletionItems] = useState<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const completionDismissed = useRef("");
  const [settings, setSettings] = useState<TuiSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);

  useEffect(() => {
    if (input === completionDismissed.current) {
      setCompletionItems([]);
      return;
    }
    const slash = slashQuery(input);
    if (slash !== null) {
      setCompletionItems(commandCompletions(slash));
      setCompletionIndex(0);
      return;
    }
    const file = fileQuery(input);
    if (file) {
      setCompletionItems(
        fileCompletions(process.cwd(), file.query),
      );
      setCompletionIndex(0);
      return;
    }
    setCompletionItems([]);
  }, [input]);

  const acceptCompletion = useCallback(() => {
    const item = completionItems[completionIndex];
    if (!item) return;
    const slash = slashQuery(input);
    if (slash !== null) {
      setInput(item.value);
    } else {
      const file = fileQuery(input);
      if (file) {
        setInput(
          `${input.slice(0, file.start)}@${item.value.replace(/^@/, "")}`,
        );
      }
    }
    setCompletionItems([]);
  }, [completionIndex, completionItems, input]);

  const historyRef = useRef<InputItem[]>([]);
  const toolIdsRef = useRef<Map<string, string>>(new Map());
  const busyRef = useRef(false);
  const conversationRef = useRef(0);
  const lastPromptRef = useRef("");
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const entries = useMemo(
    () => visibleSidebarEntries(bots, search),
    [bots, search],
  );

  const [catalogModels, setCatalogModels] = useState<string[]>([]);

  const modelOptions = useMemo(() => {
    const base =
      model &&
      !(CODEX_MODELS as readonly string[]).includes(model) &&
      !(PROVIDER_MODELS as readonly string[]).includes(model)
        ? [model, ...CODEX_MODELS, ...PROVIDER_MODELS]
        : [...CODEX_MODELS, ...PROVIDER_MODELS];
    const extra = catalogModels.filter((id) => !base.includes(id));
    return extra.length ? [...base, ...extra] : base;
  }, [model, catalogModels]);

  useEffect(() => {
    setCursor((current) => Math.min(current, entries.length - 1));
  }, [entries.length]);

  const refreshApps = useCallback(async () => {
    try {
      const connections = await listComposioConnections();
      const slugs = connections
        .map(connectionToolkit)
        .filter((slug) => slug.length > 0);
      setConnectedApps(slugs);
      return slugs;
    } catch {
      return [];
    }
  }, []);

  const activeBot =
    bots.find(
      (bot) =>
        bot.enabled &&
        bot.name.trim().toLocaleLowerCase() ===
          (activeBotName ?? "").toLocaleLowerCase(),
    ) ?? null;

  const instructions = activeBot
    ? botPrompt(activeBot)
    : settings.systemPromptPath
      ? loadSystemPrompt(settings.systemPromptPath)
      : basePrompt;

  const allowedToolIds = activeBot?.allowedTools?.length
    ? activeBot.allowedTools
    : [...BOT_TOOL_IDS];
  const botApps = activeBot?.allowedComposioApps ?? ["*"];
  const specificApps = botApps.filter((app) => app !== "*");
  const composioToolkits = specificApps.length
    ? specificApps
    : botApps.includes("*")
      ? connectedApps
      : [];

  const agentConfig: AgentConfig = {
    cli: "codex",
    model: activeBot?.model || model,
    allowedTools: allowedToolIds,
    permissionMode: activeBot?.permissionMode ?? "always_ask",
    allowedComposioTools: activeBot?.allowedComposioTools ?? ["*"],
    allowedMcpServers: activeBot?.allowedMcpServers ?? [],
    composioEnabled:
      allowedToolIds.includes("integrations") && composioToolkits.length > 0,
    composioToolkits,
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let ok = await checkGateway();
      if (!ok && !cancelled) {
        setActivity({ face: SPINNER[0], detail: "Starting gateway…" });
        const result = await ensureGateway();
        ok = result.ok;
        if (!ok && !cancelled) {
          setActivity({
            face: ":(",
            detail: `Gateway failed — ${result.message ?? "unknown error"}`,
          });
        }
      }
      if (cancelled) return;
      setGatewayOk(ok);
      if (ok) {
        void refreshApps();
        void fetchModelCatalog().then((ids) => {
          if (!cancelled) setCatalogModels(ids);
        });
      }
      if (ok && !loadBots().some((bot) => bot.enabled)) {
        setSetupOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshApps]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () => setSpinnerFrame((frame) => (frame + 1) % SPINNER.length),
      90,
    );
    return () => clearInterval(timer);
  }, [busy]);

  const updateMessage = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id
            ? ({ ...message, ...patch } as ChatMessage)
            : message,
        ),
      );
    },
    [],
  );

  const postInfo = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: newId(), kind: "info", text }]);
  }, []);

  const resetConversation = useCallback(() => {
    conversationRef.current += 1;
    historyRef.current = [];
    setMessages([]);
    setPendingPermission(null);
  }, []);

  const selectBot = useCallback(
    (bot: Bot | null) => {
      if (bot && !bot.enabled) {
        setActivity({ face: ":(", detail: `Bot "${bot.name}" is disabled` });
        return;
      }
      setActiveBotName(bot ? bot.name.trim() : null);
      resetConversation();
      setActivity(
        bot
          ? { face: ":)", detail: `Bot switched to "${bot.name}"` }
          : { face: ":)", detail: "Back to Memo" },
      );
    },
    [resetConversation],
  );

  const applyModel = useCallback(
    (next: string) => {
      saveModel(next);
      setModel(next);
      setFocus("composer");
      resetConversation();
      setActivity({ face: ":)", detail: `Model switched to ${next}` });
    },
    [resetConversation],
  );

  const botsInfo = useCallback(() => {
    const enabled = bots.filter((bot) => bot.enabled);
    return enabled.length
      ? enabled
          .map(
            (bot) =>
              `• ${bot.name} — /${bot.command || "bot"}${bot.model ? ` · ${bot.model}` : ""}`,
          )
          .join("\n")
      : "no bots yet — /setup to create one";
  }, [bots]);

  const openModelPicker = useCallback(() => {
    setModelCursor(
      Math.max(0, modelOptions.indexOf(model)),
    );
    setFocus("model");
  }, [model, modelOptions]);

  const send = useCallback(
    async (prompt: string) => {
      const text = prompt.trim();
      if (!text) return;
      if (text === "/quit") {
        exit();
        return;
      }
      const botCommand = /^\/bot(?:\s+(.+))?$/i.exec(text);
      if (botCommand) {
        const rest = botCommand[1]?.trim() ?? "";
        setInput("");
        if (!rest) {
          postInfo(botsInfo());
          return;
        }
        if (/^(?:create|new|setup)$/i.test(rest)) {
          setSetupOpen(true);
          return;
        }
        const target =
          /^(?:set|use|switch)\s+(.+)$/i.exec(rest)?.[1] ?? rest;
        const name = target.trim().replace(/^"|"$/g, "");
        const bot = findBot(name, bots);
        if (!bot) {
          const available =
            bots
              .filter((item) => item.enabled)
              .map((item) => `"${item.name}"`)
              .join(", ") || "none";
          setActivity({
            face: ":(",
            detail: `Use /bot set "name" · available: ${available}`,
          });
        } else {
          selectBot(bot);
        }
        return;
      }
      const modelCommand = /^\/model(?:\s+(.+))?$/i.exec(text);
      if (modelCommand) {
        const requested = modelCommand[1]?.trim();
        setInput("");
        if (requested) {
          const match = CODEX_MODELS.find(
            (item) =>
              item.toLocaleLowerCase() === requested.toLocaleLowerCase(),
          );
          applyModel(match ?? requested);
        } else {
          openModelPicker();
        }
        return;
      }
      if (text === "/settings") {
        setInput("");
        setSettingsOpen(true);
        return;
      }
      if (text === "/setup") {
        setSetupOpen(true);
        setInput("");
        return;
      }
      const appsCommand = /^\/(?:apps|login)(?:\s+(.+))?$/i.exec(text);
      if (appsCommand) {
        const rest = appsCommand[1]?.trim() ?? "";
        setInput("");
        const connectMatch = /^(?:connect|login|add)\s+(.+)$/i.exec(rest);
        const findMatch = /^find\s+(.+)$/i.exec(rest);
        if (connectMatch) {
          const slug = connectMatch[1].trim().toLocaleLowerCase();
          void (async () => {
            try {
              const result = await authorizeComposioToolkit(slug);
              if (result.redirect_url) {
                openExternalUrl(result.redirect_url);
                postInfo(
                  `sign-in opened for ${slug} — finish connecting in the browser`,
                );
              } else {
                postInfo(`no sign-in URL returned for ${slug}`);
              }
              await refreshApps();
            } catch (error) {
              setActivity({
                face: ":(",
                detail: `apps: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          })();
          return;
        }
        if (findMatch) {
          const query = findMatch[1].trim();
          void (async () => {
            try {
              const toolkits = await listComposioToolkits(query);
              const names = toolkits
                .map((item) => {
                  for (const key of ["slug", "name", "id"]) {
                    const value = item[key];
                    if (typeof value === "string" && value.trim()) {
                      return value.trim();
                    }
                  }
                  return "";
                })
                .filter(Boolean);
              postInfo(
                names.length
                  ? names.slice(0, 20).join("\n")
                  : `no apps found for "${query}"`,
              );
            } catch (error) {
              setActivity({
                face: ":(",
                detail: `apps: ${error instanceof Error ? error.message : String(error)}`,
              });
            }
          })();
          return;
        }
        void (async () => {
          try {
            const connections = await listComposioConnections();
            const slugs = connections
              .map(connectionToolkit)
              .filter((slug) => slug.length > 0);
            setConnectedApps(slugs);
            postInfo(
              connections.length
                ? connections
                    .map(
                      (connection) =>
                        `• ${connectionToolkit(connection) || "app"} — ${connection.status ?? "connected"}`,
                    )
                    .join("\n")
                : "no apps connected — /apps connect <app> or /apps find <name>",
            );
          } catch (error) {
            postInfo(
              `apps unavailable: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        })();
        return;
      }
      if (text === "/help" || text === "--help" || text === "-h") {
        setInput("");
        postInfo(HELP);
        return;
      }
      if (text === "/clear") {
        setInput("");
        resetConversation();
        setActivity({ face: ":)", detail: "conversation cleared" });
        return;
      }
      if (text === "/bots") {
        setInput("");
        postInfo(botsInfo());
        return;
      }
      if (text === "/status") {
        setInput("");
        const gateway =
          gatewayOk === null ? "starting…" : gatewayOk ? "online" : "offline";
        postInfo(
          [
            `gateway: ${gateway}`,
            `assistant: ${activeBot ? `"${activeBot.name}"` : "Memo (default)"}`,
            `model: codex/${activeBot?.model || model}`,
            `permission mode: ${agentConfig.permissionMode ?? "always_ask"}`,
          ].join("\n"),
        );
        return;
      }
      if (text === "/retry") {
        setInput("");
        const last = lastPromptRef.current;
        if (last) {
          void send(last);
        } else {
          setActivity({ face: ":(", detail: "nothing to retry" });
        }
        return;
      }
      if (text === "/voice") {
        setInput("");
        setVoiceMode(!voiceMode);
        setActivity({
          face: voiceMode ? ":)" : "🎤",
          detail: voiceMode ? "Voice mode off" : "Voice mode on (Gemini Live)",
        });
        return;
      }

      if (busyRef.current) {
        setActivity({ face: SPINNER[0], detail: "Still working…" });
        return;
      }
      if (gatewayOk === false) {
        setActivity({
          face: ":(",
          detail: "Gateway unavailable — restart the TUI to retry startup",
        });
        return;
      }

      setInput("");
      busyRef.current = true;
      setBusy(true);
      setActivity({ face: SPINNER[0], detail: "Thinking…" });
      const conversation = conversationRef.current;
      lastPromptRef.current = text;

      const userItem: InputItem = {
        role: "user",
        content: [{ type: "input_text", text }],
      };
      const assistantItem: InputItem = {
        role: "assistant",
        content: [{ type: "output_text", text: "" }],
      };
      const assistantId = newId();
      setMessages((prev) => [
        ...prev,
        { id: newId(), kind: "user", text },
        { id: assistantId, kind: "assistant", text: "" },
      ]);

      let assistantText = "";
      let completed = false;
      const updateAssistant = (next: string) => {
        assistantText = next;
        updateMessage(assistantId, { text: next });
      };

      try {
        for await (const event of streamResponse(
          {
            instructions,
            input: [...historyRef.current, userItem],
            memo_agent: agentConfig,
          },
        )) {
          const type = event.type;
          if (type === "response.output_text.delta") {
            const delta = event.delta;
            if (typeof delta === "string") {
              updateAssistant(assistantText + delta);
              setActivity({ face: SPINNER[0], detail: "Writing…" });
            }
          } else if (type === "memo.tool_call.started") {
            const call = (event.tool_call ?? {}) as Record<string, unknown>;
            const callId = String(call.id ?? "tool");
            const name = String(call.name ?? "tool");
            setActivity({ face: SPINNER[0], detail: `Running ${name}…` });
            if (name === "control_computer") setControlling(true);
            const toolId = newId();
            toolIdsRef.current.set(callId, toolId);
            setMessages((prev) => [
              ...prev,
              {
                id: toolId,
                kind: "tool",
                name,
                status: "running",
                detail: toolDetail(call.arguments),
              },
            ]);
          } else if (type === "memo.tool_call.completed") {
            const call = (event.tool_call ?? {}) as Record<string, unknown>;
            const callId = String(call.id ?? "tool");
            const toolId = toolIdsRef.current.get(callId);
            if (toolId) {
              updateMessage(toolId, {
                status: call.is_error ? "failed" : "completed",
                error: toolError(call),
              } as Partial<ChatMessage>);
            }
            if (call.name === "control_computer") setControlling(false);
            setActivity({ face: SPINNER[0], detail: "Thinking…" });
          } else if (type === "memo.permission.requested") {
            const permission = (event.permission ?? {}) as Record<
              string,
              unknown
            >;
            const callId = String(permission.tool_call_id ?? "");
            const toolId = callId ? toolIdsRef.current.get(callId) : undefined;
            if (toolId) {
              updateMessage(toolId, {
                status: "needs-permission",
              } as Partial<ChatMessage>);
            }
            setPendingPermission({
              id: String(permission.id ?? ""),
              command: String(permission.command ?? ""),
              cwd: String(permission.cwd ?? ""),
              kind: String(permission.kind ?? "computer_control"),
              tool_call_id: callId || undefined,
            });
            setActivity({ face: "?", detail: "Waiting for permission…" });
          } else if (type === "response.completed") {
            completed = true;
            setActivity({ face: SPINNER[0], detail: "Finishing…" });
          } else if (type === "error") {
            const error = event.error as { message?: string } | undefined;
            throw new Error(error?.message ?? "Model stream failed.");
          }
        }
        if (!completed) {
          throw new Error("The model stream ended before completing.");
        }
        assistantItem.content[0].text = assistantText;
        if (conversationRef.current === conversation) {
          historyRef.current = [...historyRef.current, userItem, assistantItem];
        }
        setActivity({ face: ":)", detail: "Done" });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        updateMessage(assistantId, {
          kind: "error",
          text: `Error: ${message}`,
        } as Partial<ChatMessage>);
        setActivity({ face: ":(", detail: "Error" });
      } finally {
        setControlling(false);
        busyRef.current = false;
        setBusy(false);
      }
    },
    [
      activeBot,
      agentConfig,
      applyModel,
      bots,
      botsInfo,
      exit,
      gatewayOk,
      instructions,
      model,
      openModelPicker,
      postInfo,
      refreshApps,
      resetConversation,
      selectBot,
      updateMessage,
    ],
  );

  const choosePermission = useCallback(
    async (allowed: boolean) => {
      const permission = pendingPermission;
      if (!permission) return;
      setPendingPermission(null);
      try {
        await resolvePermission(permission.id, allowed);
      } catch {
        // The gateway may have already resolved or expired the request.
      }
      const toolId = permission.tool_call_id
        ? toolIdsRef.current.get(permission.tool_call_id)
        : undefined;
      if (toolId) {
        updateMessage(toolId, {
          status: allowed ? "approved" : "denied",
        } as Partial<ChatMessage>);
      }
    },
    [pendingPermission, updateMessage],
  );

  const selectEntry = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      selectBot(entry.bot);
      setFocus("composer");
    },
    [entries, selectBot],
  );

  useInput((inputText, key) => {
    if (settingsOpen) return;
    if (setupOpen) {
      if (key.escape) {
        setSetupOpen(false);
        setFocus("composer");
      }
      return;
    }
    if (focusRef.current === "model") {
      if (key.upArrow) {
        setModelCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setModelCursor((current) =>
          Math.min(modelOptions.length - 1, current + 1),
        );
        return;
      }
      if (key.return) {
        const picked = modelOptions[modelCursor];
        if (picked) applyModel(picked);
        return;
      }
      if (key.escape || key.tab) {
        setFocus("composer");
      }
      return;
    }
    if (pendingPermission) {
      if (key.return || inputText === "y" || inputText === "Y") {
        void choosePermission(true);
      } else if (key.escape || inputText === "n" || inputText === "N") {
        void choosePermission(false);
      }
      return;
    }
    if (focusRef.current === "list") {
      if (key.upArrow) {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((current) => Math.min(entries.length - 1, current + 1));
        return;
      }
      if (key.return) {
        selectEntry(cursor);
        return;
      }
      if (key.escape || key.tab) {
        setFocus("composer");
        return;
      }
      if (key.backspace) {
        setSearch((current) => current.slice(0, -1));
        setCursor(0);
        return;
      }
      if (
        inputText.length === 1 &&
        !key.ctrl &&
        !key.meta &&
        !key.super
      ) {
        setSearch((current) => current + inputText);
        setCursor(0);
      }
      return;
    }
    if (completionItems.length) {
      if (key.upArrow) {
        setCompletionIndex(
          (index) => (index - 1 + completionItems.length) % completionItems.length,
        );
        return;
      }
      if (key.downArrow) {
        setCompletionIndex((index) => (index + 1) % completionItems.length);
        return;
      }
      if (key.tab) {
        acceptCompletion();
        return;
      }
      if (key.escape) {
        completionDismissed.current = input;
        setCompletionItems([]);
        return;
      }
    }
    if (key.tab) {
      setFocus("list");
      setCursor(0);
    }
  });

  const createBot = useCallback(
    (bot: {
      name: string;
      command: string;
      instructions: string;
      model: string;
      apps: string;
    }) => {
      void (async () => {
        const apps = bot.apps
          .split(",")
          .map((app) => app.trim().toLocaleLowerCase())
          .filter(Boolean);
        const entry = newBotEntry(
          bot.name,
          bot.command,
          bot.instructions,
          bot.model,
          apps.length ? apps : ["*"],
        );
        try {
          const agent = await createAgent({
            name: entry.name,
            role: "Bot",
            instructions: entry.instructions,
            color: "var(--primary)",
            cli: "codex",
            model: entry.model || "gpt-5.6-luna",
            computerTarget: "host",
          });
          entry.agentId = agent.id;
        } catch {
          // Older gateways or offline — the bot still works in the TUI.
        }
        upsertBot(entry);
        setBots(loadBots());
        setSetupOpen(false);
        setFocus("composer");
        setActiveBotName(entry.name);
        resetConversation();
        setActivity({ face: ":)", detail: `Bot "${entry.name}" is ready` });
      })();
    },
    [resetConversation],
  );

  const sidebarWidth = Math.min(30, Math.max(22, Math.floor(columns * 0.28)));
  const chatWidth = Math.max(20, columns - sidebarWidth - 2);
  const chatHeight = Math.max(4, rows - 4);
  const statusFace = busy
    ? SPINNER[spinnerFrame % SPINNER.length]
    : activity.face;
  const effectiveModel = activeBot?.model || model;

  return (
    <Box flexDirection="row" height="100%">
      <Box
        flexDirection="column"
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight
        borderColor="#313244"
        width={sidebarWidth}
      >
        <Sidebar
          entries={entries}
          activeBotName={activeBotName}
          search={search}
          cursor={cursor}
          listFocused={focus === "list"}
          busy={busy}
          spinnerFrame={spinnerFrame}
          width={sidebarWidth - 2}
        />
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {gatewayOk === false && (
          <Text color="red">
            {
              "gateway unavailable — the tui tried to start it automatically. check the error above."
            }
          </Text>
        )}
        <Box flexGrow={1} flexDirection="row">
          <Box flexDirection="column" flexGrow={1}>
            {settingsOpen ? (
              <SettingsPanel
                settings={settings}
                onChange={(next) => {
                  setSettings(next);
                  saveSettings(next);
                }}
                onClose={() => setSettingsOpen(false)}
              />
            ) : setupOpen ? (
              <BotSetup
                defaultModel={model}
                onCreate={createBot}
                onSkip={() => {
                  setSetupOpen(false);
                  setFocus("composer");
                }}
              />
            ) : focus === "model" ? (
              <ModelPicker
                models={modelOptions}
                selected={model}
                cursor={modelCursor}
              />
            ) : (
              <MessageList
                messages={messages}
                width={chatWidth - 2}
                height={chatHeight}
              />
            )}
          </Box>
        </Box>
        {pendingPermission && (
          <PermissionPrompt permission={pendingPermission} />
        )}
        <Text dimColor>
          {`${statusFace} ${activity.detail} · ${effectiveModel.includes("/") ? effectiveModel : `codex/${effectiveModel}`}${controlling ? " · controlling" : ""}`}
        </Text>
        <CompletionMenu
          items={completionItems}
          selected={completionIndex}
        />
        <Composer
          input={input}
          onChange={(value) => {
            completionDismissed.current = "";
            setInput(value);
          }}
          onSubmit={(value) => {
            if (completionItems.length) acceptCompletion();
            else void send(value);
          }}
          focused={focus === "composer" && !setupOpen && !pendingPermission}
          busy={busy}
          blocked={setupOpen || settingsOpen || focus === "model"}
        />
        <Text dimColor>
          {focus === "list"
            ? "↑↓ select · type to filter · enter switch · esc chat"
            : focus === "model"
              ? ""
              : "tab bots · /model · enter send · /quit exit"}
        </Text>
      </Box>
    </Box>
  );
}
