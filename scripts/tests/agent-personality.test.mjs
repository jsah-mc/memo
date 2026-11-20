import assert from "node:assert/strict";
import { test } from "node:test";
import { agentSystemPrompt } from "../../apps/desktop/src/agents/agent-personality.ts";

test("the agent's identity, chosen style and soul reach its system prompt", () => {
  const prompt = agentSystemPrompt({name: "Nova", role: "Research partner", description: "Find evidence.", style: "warm", soul: "Be honest and curious.", instructions: "Cite sources.", cli: "antigravity", model: "gemini-2.5-pro"});
  for (const value of ["Nova", "Research partner", "Find evidence.", "friendly, patient", "Be honest and curious.", "Cite sources.", "antigravity", "gemini-2.5-pro", "report these exact values", ":P", "screen", "tool"]) assert.ok(prompt.includes(value));
});

test("the default agent prompt tells it to act and use CUA Driver tools only", () => {
  const prompt = agentSystemPrompt({name: "Memo", role: "General assistant", description: "Practical.", style: "balanced", soul: "Curious.", instructions: "Be useful.", cli: "codex", model: "gpt-5.6-luna"});
  assert.match(prompt, /CUA Driver tools/i);
  assert.match(prompt, /inspect_computer_screen/i);
  assert.match(prompt, /control_computer/i);
  assert.match(prompt, /no shell/i);
  assert.match(prompt, /screen-inspection tool/i);
  assert.doesNotMatch(prompt, /you are a helpful assistant/i);
});
