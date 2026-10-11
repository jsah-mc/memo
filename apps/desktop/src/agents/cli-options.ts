export const CLI_OPTIONS = [
  { id: "codex", label: "Codex CLI", defaultModel: "gpt-5.6-luna" },
  { id: "claude", label: "Claude Code", defaultModel: "sonnet" },
  {
    id: "antigravity",
    label: "Antigravity CLI",
    defaultModel: "gemini-2.5-pro",
  },
  { id: "opencode", label: "OpenCode", defaultModel: "default" },
  { id: "ollama", label: "Ollama", defaultModel: "qwen3" },
  { id: "lmstudio", label: "LM Studio", defaultModel: "local-model" },
  { id: "grok-build", label: "Grok Build", defaultModel: "grok-4.6" },
  { id: "cursor", label: "Cursor Agent", defaultModel: "auto" },
  { id: "hermes", label: "Hermes Agent", defaultModel: "default" },
  { id: "pi", label: "Pi", defaultModel: "default" },
] as const;

export type CLIBackendId = (typeof CLI_OPTIONS)[number]["id"];

const CUSTOM_MODELS_KEY = "memo.custom-models.v1";

export function customModels(cli: CLIBackendId): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CUSTOM_MODELS_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const models = (value as Record<string, unknown>)[cli];
    return Array.isArray(models)
      ? models.filter((model): model is string => typeof model === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberCustomModel(cli: CLIBackendId, model: string): string[] {
  const next = Array.from(new Set([model, ...customModels(cli)])).slice(0, 20);
  const current = Object.fromEntries(
    CLI_OPTIONS.map((option) => [option.id, customModels(option.id)]),
  );
  localStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify({ ...current, [cli]: next }));
  return next;
}
