import { create } from "zustand";

export type TaskActivityItem = {
  id: string;
  agentId: string;
  title: string;
  status: "running" | "done" | "error" | "cancelled";
  startedAt: number;
  finishedAt?: number;
  tools: Array<{ id: string; name: string; status: "running" | "done" | "error" }>;
  error?: string;
};

type TaskActivityStore = {
  items: TaskActivityItem[];
  start(item: TaskActivityItem): void;
  tool(taskId: string, tool: TaskActivityItem["tools"][number]): void;
  finish(taskId: string, status: TaskActivityItem["status"], error?: string): void;
  requestCancel(taskId: string): void;
  clear(): void;
};

export const useTaskActivity = create<TaskActivityStore>((set) => ({
  items: [],
  start: (item) => set((state) => ({ items: [item, ...state.items].slice(0, 50) })),
  tool: (taskId, tool) => set((state) => ({ items: state.items.map((item) => item.id !== taskId ? item : { ...item, tools: [...item.tools.filter((entry) => entry.id !== tool.id), tool] }) })),
  finish: (taskId, status, error) => set((state) => ({ items: state.items.map((item) => {
    if (item.id !== taskId) return item;
    const finalStatus = item.status === "cancelled" ? "cancelled" : status;
    return { ...item, status: finalStatus, error, finishedAt: Date.now() };
  }) })),
  requestCancel: (taskId) => set((state) => ({ items: state.items.map((item) => item.id === taskId ? { ...item, status: "cancelled", finishedAt: Date.now() } : item) })),
  clear: () => set((state) => ({ items: state.items.filter((item) => item.status === "running") })),
}));
