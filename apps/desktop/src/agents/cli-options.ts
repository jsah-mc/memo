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

const MODEL_OPTIONS: Readonly<Record<CLIBackendId, readonly string[]>> = {
  codex: [
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-6-sol",
    "gpt-6.1-sol",
    "gpt-6-astra",
  ],
  claude: ["sonnet", "opus", "haiku"],
  antigravity: ["gemini-2.5-pro", "gemini-2.5-flash"],
  opencode: ["default"],
  ollama: ["qwen3", "llama3.3", "deepseek-r1"],
  lmstudio: ["local-model"],
  "grok-build": ["grok-4.6"],
  cursor: ["auto"],
  hermes: [
    "default",
    "anthropic/claude-sonnet-4",
    "openai/gpt-5.5",
    "openrouter:anthropic/claude-sonnet-4",
  ],
  pi: ["default"],
};

export function modelOptions(cli: CLIBackendId, current: string) {
  return Array.from(new Set([current, ...MODEL_OPTIONS[cli]]));
}
