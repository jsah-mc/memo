import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage, ToolStatus } from "../types";

const TOOL_GLYPHS: Record<ToolStatus, { glyph: string; color: string }> = {
  running: { glyph: "◌", color: "cyan" },
  completed: { glyph: "✓", color: "green" },
  failed: { glyph: "✗", color: "red" },
  "needs-permission": { glyph: "?", color: "yellow" },
  approved: { glyph: "✓", color: "green" },
  denied: { glyph: "✕", color: "red" },
};

export function ToolCall({ message }: { message: ChatMessage }) {
  if (message.kind !== "tool") return null;
  const { glyph, color } = TOOL_GLYPHS[message.status];
  return (
    <Box flexDirection="column">
      <Text color={color} dimColor={message.status === "running"}>
        {`${glyph} ${message.name} · ${message.status}`}
      </Text>
      {message.detail && <Text dimColor>{`    ${message.detail}`}</Text>}
      {message.error && <Text color="red" dimColor>{`    ${message.error}`}</Text>}
    </Box>
  );
}

function MessageBody({ message }: { message: ChatMessage }) {
  if (message.kind === "tool") return <ToolCall message={message} />;
  if (message.kind === "user") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" dimColor>
          {"❯ you"}
        </Text>
        <Text>{message.text}</Text>
      </Box>
    );
  }
  if (message.kind === "error") {
    return <Text color="red">{`✗ ${message.text}`}</Text>;
  }
  if (message.kind === "info") {
    return <Text dimColor>{message.text}</Text>;
  }
  return <Text>{message.text}</Text>;
}

export function messageHeight(message: ChatMessage, width: number): number {
  const textWidth = Math.max(8, width - 2);
  const lines = (text: string) =>
    text
      .split("\n")
      .reduce(
        (count, line) =>
          count + Math.max(1, Math.ceil(line.length / textWidth)),
        0,
      );
  if (message.kind === "tool") {
    return 1 + (message.detail ? 1 : 0) + (message.error ? 1 : 0);
  }
  return 1 + lines(message.text);
}

export function visibleMessages(
  messages: ChatMessage[],
  width: number,
  height: number,
): ChatMessage[] {
  const visible: ChatMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = messageHeight(message, width);
    if (used + cost > height && visible.length > 0) break;
    visible.unshift(message);
    used += cost;
  }
  return visible;
}

export function MessageList({
  messages,
  width,
  height,
}: {
  messages: ChatMessage[];
  width: number;
  height: number;
}) {
  const visible = visibleMessages(messages, width, height);
  return (
    <Box flexDirection="column" width={width} height={height}>
      {visible.map((message) => (
        <Box key={message.id} flexDirection="column" marginBottom={1}>
          <MessageBody message={message} />
        </Box>
      ))}
    </Box>
  );
}
