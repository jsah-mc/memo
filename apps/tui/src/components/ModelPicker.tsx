import React from "react";
import { Box, Text } from "ink";

export function ModelPicker({
  models,
  selected,
  cursor,
}: {
  models: readonly string[];
  selected: string;
  cursor: number;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      marginY={1}
      width={40}
    >
      <Text color="cyan" bold>
        {"// model"}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {models.map((model, index) => {
          const highlighted = index === cursor;
          const active = model === selected;
          return (
            <Text
              key={model}
              bold={active}
              color={active ? "cyan" : highlighted ? "white" : undefined}
              backgroundColor={highlighted ? "#1f3a5f" : undefined}
            >
              {`${highlighted ? "▸ " : "  "}${active ? "●" : "○"} ${model}`}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>{"↑↓ select · enter apply · esc cancel"}</Text>
    </Box>
  );
}
