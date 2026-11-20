import React from "react";
import { Box, Text } from "ink";
import type { PermissionRequest } from "../gateway";

export function PermissionPrompt({
  permission,
}: {
  permission: PermissionRequest;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Text color="yellow" bold>
        allow computer control?
      </Text>
      <Text dimColor>{permission.command}</Text>
      {permission.cwd && <Text dimColor>{`cwd: ${permission.cwd}`}</Text>}
      <Text dimColor>{"enter allow · esc deny"}</Text>
    </Box>
  );
}
