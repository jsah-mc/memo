import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function BotSetup({
  defaultModel,
  onCreate,
  onSkip,
}: {
  defaultModel: string;
  onCreate: (bot: {
    name: string;
    command: string;
    instructions: string;
    model: string;
    apps: string;
  }) => void;
  onSkip: () => void;
}) {
  const [name, setName] = React.useState("");
  const [command, setCommand] = React.useState("");
  const [commandTouched, setCommandTouched] = React.useState(false);
  const [model, setModel] = React.useState(defaultModel);
  const [apps, setApps] = React.useState("*");
  const [instructions, setInstructions] = React.useState(
    "Act as a persistent task bot. Track the current objective, report progress briefly, and finish with the next useful action.",
  );
  const [focus, setFocus] = React.useState<
    "name" | "command" | "model" | "apps" | "instructions"
  >("name");

  const submit = () => {
    if (!name.trim()) {
      setFocus("name");
      return;
    }
    onCreate({
      name: name.trim(),
      command: command.trim(),
      instructions,
      model: model.trim(),
      apps: apps.trim(),
    });
  };

  const field = (
    key: "name" | "command" | "model" | "apps" | "instructions",
    label: string,
    value: string,
    setValue: (value: string) => void,
    placeholder: string,
  ) => (
    <Box flexDirection="column" marginY={1}>
      <Text dimColor>{label}</Text>
      <TextInput
        value={value}
        onChange={(next) => {
          setValue(next);
          if (key === "command") setCommandTouched(true);
          if (key === "name" && !commandTouched) setCommand(slugFor(next));
        }}
        onSubmit={() => {
          if (key === "instructions") submit();
          else if (key === "name") setFocus("command");
          else if (key === "command") setFocus("model");
          else if (key === "model") setFocus("apps");
          else setFocus("instructions");
        }}
        placeholder={placeholder}
        focus={focus === key}
      />
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      marginY={1}
      width={72}
    >
      <Text color="cyan" bold>
        {"// first bot"}
      </Text>
      <Text dimColor>
        no bots yet — describe the first one. it is saved for memo and the
        desktop app.
      </Text>
      {field("name", "name", name, setName, "Builder")}
      {field("command", "command (/…)", command, setCommand, "builder")}
      {field("model", "model", model, setModel, "gpt-5.6-luna")}
      {field(
        "apps",
        "apps (gmail, slack — * for all)",
        apps,
        setApps,
        "*",
      )}
      {field(
        "instructions",
        "instructions",
        instructions,
        setInstructions,
        "What should this bot do?",
      )}
      <Text dimColor>
        {"enter next · enter on instructions creates · esc skips"}
      </Text>
    </Box>
  );
}

function slugFor(value: string): string {
  return (
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "bot"
  );
}
