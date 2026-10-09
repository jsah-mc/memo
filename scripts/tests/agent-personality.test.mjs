import assert from "node:assert/strict";
import { test } from "node:test";
import { agentSystemPrompt } from "../../apps/desktop/src/agents/agent-personality.ts";

test("the agent's identity, chosen style and soul reach its system prompt", () => {
  const prompt = agentSystemPrompt({name: "Nova", role: "Research partner", description: "Find evidence.", style: "warm", soul: "Be honest and curious.", instructions: "Cite sources.", cli: "antigravity", model: "gemini-2.5-pro"});
  for (const value of ["Nova", "Research partner", "Find evidence.", "friendly, patient", "Be honest and curious.", "Cite sources.", "antigravity", "gemini-2.5-pro", "report these exact values"]) assert.ok(prompt.includes(value));
});
