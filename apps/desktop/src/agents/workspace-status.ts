import { create } from "zustand";

export type WorkspaceRunResult = "done" | "error" | "cancelled";

type WorkspaceStatus = Readonly<{
  running: number;
  unread: number;
  lastResult?: WorkspaceRunResult;
}>;

type WorkspaceStatusStore = {
  activeScope: string;
  statuses: Record<string, WorkspaceStatus>;
  setActiveScope(scope: string): void;
  start(scope: string): void;
  finish(scope: string, label: string, result: WorkspaceRunResult): void;
  markRead(scope: string): void;
};

const emptyStatus: WorkspaceStatus = { running: 0, unread: 0 };

const notifyWhenAllowed = (label: string, result: WorkspaceRunResult) => {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const detail = result === "error" ? "failed" : result === "cancelled" ? "was cancelled" : "finished";
  new Notification("Memo task update", { body: `${label} ${detail}.` });
};

export const useWorkspaceStatus = create<WorkspaceStatusStore>((set, get) => ({
  activeScope: "",
  statuses: {},
  setActiveScope: (scope) => set((state) => ({
    activeScope: scope,
    statuses: {
      ...state.statuses,
      [scope]: { ...(state.statuses[scope] ?? emptyStatus), unread: 0 },
    },
  })),
  start: (scope) => set((state) => {
    const current = state.statuses[scope] ?? emptyStatus;
    return {
      statuses: {
        ...state.statuses,
        [scope]: { ...current, running: current.running + 1 },
      },
    };
  }),
  finish: (scope, label, result) => {
    const inactive = get().activeScope !== scope;
    set((state) => {
      const current = state.statuses[scope] ?? emptyStatus;
      return {
        statuses: {
          ...state.statuses,
          [scope]: {
            running: Math.max(0, current.running - 1),
            unread: inactive ? current.unread + 1 : 0,
            lastResult: result,
          },
        },
      };
    });
    if (inactive || document.visibilityState === "hidden") notifyWhenAllowed(label, result);
  },
  markRead: (scope) => set((state) => ({
    statuses: {
      ...state.statuses,
      [scope]: { ...(state.statuses[scope] ?? emptyStatus), unread: 0 },
    },
  })),
}));
