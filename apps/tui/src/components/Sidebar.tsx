import React from "react";
import { Box, Text } from "ink";
import {
  BOT_FACES,
  BOT_FACE_SPINNER,
  type SidebarEntry,
} from "../types";

export function Sidebar({
  entries,
  activeBotName,
  search,
  cursor,
  listFocused,
  busy,
  spinnerFrame,
  width,
}: {
  entries: SidebarEntry[];
  activeBotName: string | null;
  search: string;
  cursor: number;
  listFocused: boolean;
  busy: boolean;
  spinnerFrame: number;
  width: number;
}) {
  const activeFace = busy
    ? BOT_FACE_SPINNER[spinnerFrame % BOT_FACE_SPINNER.length]
    : BOT_FACES.idle;
  const isActiveEntry = (entry: SidebarEntry) =>
    entry.bot === null
      ? activeBotName === null
      : activeBotName !== null &&
        entry.bot.name.trim().toLocaleLowerCase() ===
          activeBotName.toLocaleLowerCase();
  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      <Text color="cyan" bold>
        {"// memo"}
      </Text>
      <Box marginY={1}>
        <Text dimColor>{"grep "}</Text>
        <Text>{search}</Text>
        {listFocused && <Text color="cyan">▌</Text>}
      </Box>
      <Text dimColor>{"// bots"}</Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, index) => {
          const active = isActiveEntry(entry);
          const face = active ? activeFace : BOT_FACES.idle;
          const highlighted = listFocused && index === cursor;
          return (
            <Box
              key={entry.key}
              flexDirection="column"
              backgroundColor={highlighted ? "#1f3a5f" : undefined}
            >
              <Text
                bold={active}
                dimColor={entry.dim}
                color={active ? "cyan" : highlighted ? "white" : undefined}
              >
                {`${highlighted ? "▸ " : "  "}${face} ${entry.name}`}
              </Text>
              <Text dimColor>{`    ${entry.subtitle}`}</Text>
            </Box>
          );
        })}
      </Box>
      {entries.length === 1 && (
        <Text dimColor>{"no bots yet — /setup"}</Text>
      )}
    </Box>
  );
}
