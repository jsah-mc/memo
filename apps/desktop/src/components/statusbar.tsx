import { useAuiState } from "@assistant-ui/react";
import {
  BotIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

type GatewayStatus = {
  state: "connecting" | "online" | "offline" | "error";
  running: boolean;
  latencyMs: number | null;
  message?: string;
};

const OFFLINE: GatewayStatus = {
  state: "offline",
  running: false,
  latencyMs: null,
};
const CONNECTING_TEXT = "Connecting";
const SCRAMBLE_SYMBOLS = "!@#$%^&()";

export function Statusbar() {
  const agentStatus = useAuiState((state) => {
    if (state.thread.isRunning) return "working";
    const lastMessage = state.thread.messages.at(-1);
    if (
      lastMessage?.role === "assistant" &&
      lastMessage.status?.type === "incomplete" &&
      lastMessage.status.reason === "error"
    ) {
      return "error";
    }
    return "ready";
  });
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [scrambleStep, setScrambleStep] = useState(0);

  useEffect(() => {
    let active = true;
    let timeout = 0;
    const refresh = async (): Promise<void> => {
      const status = await window.desktopApi
        .getGatewayStatus()
        .catch(() => OFFLINE);
      if (!active) return;
      setGateway(status);
      timeout = window.setTimeout(
        (): void => {
          void refresh();
        },
        status.state === "connecting" ? 350 : 5_000,
      );
    };

    void refresh();
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (gateway?.state !== "connecting") {
      setScrambleStep(0);
      return;
    }

    const interval = window.setInterval(() => {
      setScrambleStep(
        (step) => (step + 1) % (CONNECTING_TEXT.length + 5),
      );
    }, 120);
    return () => window.clearInterval(interval);
  }, [gateway?.state]);

  const connectingLabel = [...CONNECTING_TEXT]
    .map((character, index) =>
      index < Math.min(scrambleStep, CONNECTING_TEXT.length)
        ? SCRAMBLE_SYMBOLS[index % SCRAMBLE_SYMBOLS.length]
        : character,
    )
    .join("");

  const AgentIcon =
    agentStatus === "working"
      ? LoaderCircleIcon
      : agentStatus === "error"
        ? CircleAlertIcon
        : BotIcon;
  const agentLabel =
    agentStatus === "working"
      ? "Agent: Working"
      : agentStatus === "error"
        ? "Agent: Error"
        : "Agent: Ready";

  return (
    <footer className="fixed inset-x-0 bottom-0 z-60 flex h-6 select-none items-center justify-between bg-sidebar px-2 text-[11px] text-foreground">
      <div
        className="flex h-full items-center gap-1.5 px-1.5"
        title={agentLabel}
      >
        <AgentIcon
          className={`size-3.5 ${agentStatus === "working" ? "animate-spin" : ""}`}
        />
        <span>{agentLabel}</span>
      </div>

      <div
        className="flex h-full items-center gap-1.5 px-1.5"
        title={
          gateway?.running
            ? `Gateway running${gateway.latencyMs == null ? "" : ` (${gateway.latencyMs} ms)`}`
            : (gateway?.message ?? "Gateway is starting")
        }
      >
        {gateway === null || gateway.state === "connecting" ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : gateway.running ? (
          <WifiIcon className="size-3.5" />
        ) : (
          <WifiOffIcon className="size-3.5" />
        )}
        <span>
          {gateway === null
            ? "Gateway: Connecting"
            : gateway.state === "connecting"
              ? `Gateway: ${connectingLabel}`
            : gateway.running
              ? `Gateway: Online${gateway.latencyMs == null ? "" : ` · ${gateway.latencyMs} ms`}`
              : gateway.state === "error"
                ? "Gateway: Error"
                : "Gateway: Offline"}
        </span>
      </div>
    </footer>
  );
}
