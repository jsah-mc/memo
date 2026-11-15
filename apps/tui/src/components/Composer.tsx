import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function Composer({
  input,
  onChange,
  onSubmit,
  focused,
  busy,
  blocked,
}: {
  input: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  focused: boolean;
  busy: boolean;
  blocked: boolean;
}) {
  return (
    <Box>
      <Text color="cyan" bold>
        {"❯ "}
      </Text>
      <TextInput
        value={input}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={
          busy ? "thinking…" : blocked ? "finish or escape above" : "message memo"
        }
        focus={focused}
      />
    </Box>
  );
}
