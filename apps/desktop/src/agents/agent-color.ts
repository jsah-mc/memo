export const DEFAULT_AGENT_COLOR = "#6d8f82";

export function moderatedAgentColor(color: string): string {
  const safe = /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_AGENT_COLOR;
  return `color-mix(in srgb, ${safe} 72%, var(--muted-foreground) 28%)`;
}
