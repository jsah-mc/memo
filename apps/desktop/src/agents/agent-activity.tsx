import { useEffect, useState } from "react";
import { create } from "zustand";

export type AgentActivity = "idle" | "loading" | "done" | "error";

const SPINNER = ["[.  ]", "[.. ]", "[... ]", "[ ..]", "[  .]", "[   ]"];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

type ActivityStore = {
  activities: Record<string, AgentActivity>;
  setActivity: (agentId: string, activity: AgentActivity) => void;
};

const useActivityStore = create<ActivityStore>((set) => ({
  activities: {},
  setActivity: (agentId, activity) =>
    set((state) => ({ activities: { ...state.activities, [agentId]: activity } })),
}));

export function setAgentActivity(agentId: string, activity: AgentActivity) {
  const timer = timers.get(agentId);
  if (timer) clearTimeout(timer);
  useActivityStore.getState().setActivity(agentId, activity);
  if (activity === "done" || activity === "error") {
    timers.set(agentId, setTimeout(() => {
      useActivityStore.getState().setActivity(agentId, "idle");
      timers.delete(agentId);
    }, 1800));
  }
}

export function AgentActivityFace({ agentId, className = "", color }: Readonly<{ agentId: string; className?: string; color?: string }>) {
  const activity = useActivityStore((state) => state.activities[agentId] ?? "idle");
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (activity !== "loading") return;
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % SPINNER.length), 100);
    return () => window.clearInterval(timer);
  }, [activity]);

  const face = activity === "loading"
    ? SPINNER[frame]
    : activity === "done"
      ? "[^_^]"
      : activity === "error"
        ? "[x_x]"
        : "[o_o]";
  return <span className={className} style={color ? { color } : undefined} role="status" aria-label={`Agent ${activity}`} title={activity}>{face}</span>;
}
