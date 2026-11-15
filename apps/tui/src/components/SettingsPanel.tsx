import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { SETTINGS_FIELDS, type TuiSettings } from "../settings";

export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: TuiSettings;
  onChange: (settings: TuiSettings) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = React.useState(0);
  const [editing, setEditing] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState("");

  useInput((input, key) => {
    if (editing !== null) {
      if (key.return) {
        const field = SETTINGS_FIELDS[editing];
        onChange({ ...settings, [field.key]: draft.trim() });
        setEditing(null);
      } else if (key.escape) {
        setEditing(null);
      }
      return;
    }
    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
    } else if (key.downArrow) {
      setCursor((current) =>
        Math.min(SETTINGS_FIELDS.length - 1, current + 1),
      );
    } else if (key.return) {
      const field = SETTINGS_FIELDS[cursor];
      setDraft(settings[field.key]);
      setEditing(cursor);
    } else if (key.escape) {
      onClose();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#45475a"
      paddingX={2}
      paddingY={1}
      width={72}
    >
      <Text bold color="#89b4fa">
        settings
      </Text>
      {SETTINGS_FIELDS.map((field, index) => {
        const active = index === cursor && editing === null;
        if (editing === index) {
          return (
            <Box key={field.key} marginTop={1}>
              <Text color="#89b4fa">{`${field.label}: `}</Text>
              <TextInput
                value={draft}
                onChange={setDraft}
                onSubmit={() => {
                  onChange({ ...settings, [field.key]: draft.trim() });
                  setEditing(null);
                }}
              />
            </Box>
          );
        }
        return (
          <Box key={field.key} marginTop={index === 0 ? 1 : 0}>
            <Text color={active ? "#89b4fa" : "#6b7280"}>
              {`${active ? "▸ " : "  "}${field.label}: `}
            </Text>
            <Text color={settings[field.key] ? "#cdd6f4" : "#6b7280"}>
              {settings[field.key] || "—"}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>enter edit · esc close</Text>
      </Box>
    </Box>
  );
}
