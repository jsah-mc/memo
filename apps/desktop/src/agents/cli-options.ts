export const CLI_OPTIONS = [
  { id: "codex", label: "Codex CLI", defaultModel: "gpt-5.6-luna" },
  { id: "claude", label: "Claude Code", defaultModel: "sonnet" },
  { id: "antigravity", label: "Antigravity CLI", defaultModel: "gemini-2.5-pro" },
  { id: "opencode", label: "OpenCode", defaultModel: "default" },
  { id: "ollama", label: "Ollama", defaultModel: "qwen3" },
  { id: "lmstudio", label: "LM Studio", defaultModel: "local-model" },
  { id: "grok-build", label: "Grok Build", defaultModel: "grok-4.6" },
  { id: "cursor", label: "Cursor Agent", defaultModel: "auto" },
  { id: "pi", label: "Pi", defaultModel: "default" },
] as const;

export type CLIBackendId = (typeof CLI_OPTIONS)[number]["id"];
