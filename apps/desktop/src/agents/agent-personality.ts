import type { AgentProfile } from "./agent-provider";

export const AGENT_STYLES = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Thoughtful, clear, and adaptable.",
    prompt:
      "Use a thoughtful, balanced tone. Match the level of detail to the task.",
  },
  {
    id: "warm",
    label: "Warm",
    description: "Friendly, patient, and encouraging.",
    prompt: "Be friendly, patient, and encouraging without flattery.",
  },
  {
    id: "direct",
    label: "Direct",
    description: "Concise, practical, and candid.",
    prompt: "Be concise, practical, and candid. Lead with the answer.",
  },
  {
    id: "playful",
    label: "Playful",
    description: "Curious, creative, and lighthearted.",
    prompt:
      "Be curious and creative, with light humor when appropriate. Stay accurate.",
  },
] as const;

export function agentSystemPrompt(agent: AgentProfile): string {
  const style = AGENT_STYLES.find((item) => item.id === agent.style);
  return [
    `You are ${agent.name}, a ${agent.role}.`,
    agent.description,
    style?.prompt ?? `Communication style: ${agent.style}`,
    `Soul — your values and personality:\n${agent.soul}`,
    `Working instructions:\n${agent.instructions}`,
  ].join("\n\n");
}
