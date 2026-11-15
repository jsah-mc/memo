import type { Bot } from "./bots";

export const BOT_FACES = {
  idle: "[o_o]",
  done: "[^_^]",
  error: "[x_x]",
} as const;

export const BOT_FACE_SPINNER = [
  "[.  ]",
  "[.. ]",
  "[... ]",
  "[ ..]",
  "[  .]",
  "[   ]",
];

export type ToolStatus =
  | "running"
  | "completed"
  | "failed"
  | "needs-permission"
  | "approved"
  | "denied";

export type ChatMessage = { id: string } & (
  | { kind: "user" | "assistant" | "error" | "info"; text: string }
  | {
      kind: "tool";
      name: string;
      status: ToolStatus;
      detail?: string;
      error?: string;
    }
);

export type SidebarEntry = {
  key: string;
  bot: Bot | null;
  name: string;
  subtitle: string;
  dim?: boolean;
};

export function visibleSidebarEntries(
  bots: Bot[],
  search: string,
): SidebarEntry[] {
  const query = search.trim().toLocaleLowerCase();
  const entries: SidebarEntry[] = [
    {
      key: "memo",
      bot: null,
      name: "Memo",
      subtitle: "default assistant",
    },
  ];
  for (const bot of bots) {
    if (
      query &&
      !`${bot.name} ${bot.command}`.toLocaleLowerCase().includes(query)
    ) {
      continue;
    }
    entries.push({
      key: bot.name,
      bot,
      name: bot.name,
      subtitle: `/${bot.command || "bot"} · ${bot.permissionMode}`,
      dim: !bot.enabled,
    });
  }
  return entries;
}
