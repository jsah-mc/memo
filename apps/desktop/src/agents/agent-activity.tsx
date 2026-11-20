import { create } from "zustand";

export type AgentActivity = "idle" | "loading" | "done" | "error";

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

/**
 * Small colored status dot. The agent color carries identity; the dot pulses
 * while the agent is working so activity stays legible without ASCII art.
 */
export function AgentActivityDot({
  agentId,
  className = "",
  color,
}: Readonly<{ agentId: string; className?: string; color?: string }>) {
  const activity = useActivityStore((state) => state.activities[agentId] ?? "idle");
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${activity === "loading" ? "animate-pulse" : ""} ${className}`}
      style={color ? { backgroundColor: color } : undefined}
      role="status"
      aria-label={`Agent ${activity}`}
      title={activity}
    />
  );
}
