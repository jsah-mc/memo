import React from "react";
import { Box, Text } from "ink";
import type { CompletionItem } from "../completions";

export function CompletionMenu({
  items,
  selected,
}: {
  items: CompletionItem[];
  selected: number;
}) {
  if (!items.length) return null;
  const VISIBLE = 10;
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(VISIBLE / 2), items.length - VISIBLE),
  );
  const window = items.slice(start, start + VISIBLE);
  return (
    <Box flexDirection="column" marginBottom={1}>
      {start > 0 && <Text dimColor>{`  … ${start} more above`}</Text>}
      {window.map((item, offset) => {
        const index = start + offset;
        return (
          <Box key={item.label}>
            <Text
              color={index === selected ? "#89b4fa" : "#a6adc8"}
              dimColor={index !== selected}
            >
              {index === selected ? "▸ " : "  "}
              {item.label}
              {item.hint ? `  ${item.hint}` : ""}
            </Text>
          </Box>
        );
      })}
      {start + VISIBLE < items.length && (
        <Text dimColor>{`  … ${items.length - start - VISIBLE} more below`}</Text>
      )}
    </Box>
  );
}
