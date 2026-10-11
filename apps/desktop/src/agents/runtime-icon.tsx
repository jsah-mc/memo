import type { CLIBackendId } from "@/agents/cli-options";

const RUNTIME_ICON_PATHS: Record<CLIBackendId, string> = {
  codex: "/runtime-icons/codex.svg",
  claude: "/runtime-icons/claude.svg",
  antigravity: "/runtime-icons/antigravity.svg",
  opencode: "/runtime-icons/opencode.svg",
  ollama: "/runtime-icons/ollama.svg",
  lmstudio: "/runtime-icons/lmstudio.svg",
  "grok-build": "/runtime-icons/grok-build.svg",
  cursor: "/runtime-icons/cursor.svg",
  hermes: "/runtime-icons/hermes.svg",
  pi: "/runtime-icons/pi.svg",
};

export function RuntimeIcon({
  runtime,
  className = "size-8",
}: Readonly<{ runtime: CLIBackendId; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1.5 shadow-sm ring-1 ring-black/10 ${className}`}
    >
      <img
        src={RUNTIME_ICON_PATHS[runtime]}
        alt=""
        className="size-full object-contain"
        draggable={false}
      />
    </span>
  );
}
