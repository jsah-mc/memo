import { exec } from "node:child_process";

export type GatewayEvent = Record<string, unknown> & { type?: string };

export type PermissionRequest = {
  id: string;
  command: string;
  cwd: string;
  kind: string;
  tool_call_id?: string;
};

export type AgentConfig = {
  cli: string;
  model: string;
  allowedTools?: string[];
  permissionMode?: string;
  allowedComposioTools?: string[];
  allowedComposioApps?: string[];
  allowedMcpServers?: string[];
  composioEnabled?: boolean;
  composioToolkits?: string[];
};

export type InputItem = {
  role: "user" | "assistant";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
};

export const GATEWAY_URL =
  process.env.MEMO_GATEWAY_URL ?? "http://127.0.0.1:4010";

const HEADERS = {
  "content-type": "application/json",
  accept: "text/event-stream",
  "x-memo-desktop": "1",
  "x-memo-computer-tools": "1",
};

export async function checkGateway(): Promise<boolean> {
  try {
    const response = await fetch(`${GATEWAY_URL}/health/liveliness`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

let catalogCache: string[] | null = null;

export async function fetchModelCatalog(): Promise<string[]> {
  if (catalogCache) return catalogCache;
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const ids = (payload.data ?? [])
      .map((item) => (typeof item.id === "string" ? item.id : ""))
      .filter((id) => id.includes("/"));
    catalogCache = ids;
    return ids;
  } catch {
    return [];
  }
}

export type ComposioConnection = {
  id?: string;
  toolkit?: unknown;
  name?: string;
  status?: string;
};

export async function getComposioStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/composio/status`);
    if (!response.ok) return false;
    const payload = (await response.json()) as { configured?: boolean };
    return payload.configured === true;
  } catch {
    return false;
  }
}

export async function listComposioConnections(): Promise<
  ComposioConnection[]
> {
  const response = await fetch(`${GATEWAY_URL}/v1/composio/connections`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(
      payload?.detail ?? `Connections failed (${response.status}).`,
    );
  }
  const payload = (await response.json()) as { data?: unknown };
  return Array.isArray(payload.data)
    ? (payload.data as ComposioConnection[])
    : [];
}

export async function authorizeComposioToolkit(
  toolkit: string,
): Promise<{ redirect_url?: string }> {
  const response = await fetch(
    `${GATEWAY_URL}/v1/composio/authorize/${encodeURIComponent(toolkit)}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(payload?.detail ?? `Authorize failed (${response.status}).`);
  }
  return (await response.json()) as { redirect_url?: string };
}

export async function listComposioToolkits(
  search = "",
): Promise<Array<Record<string, unknown>>> {
  const query = search.trim()
    ? `?search=${encodeURIComponent(search.trim())}`
    : "";
  const response = await fetch(`${GATEWAY_URL}/v1/composio/toolkits${query}`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(payload?.detail ?? `Toolkits failed (${response.status}).`);
  }
  const payload = (await response.json()) as { data?: unknown };
  return Array.isArray(payload.data)
    ? (payload.data as Array<Record<string, unknown>>)
    : [];
}

export function openExternalUrl(url: string): void {
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => {});
}

export async function createAgent(agent: {
  name: string;
  role: string;
  instructions: string;
  color: string;
  cli: string;
  model: string;
  computerTarget?: string;
}): Promise<{ id: string }> {
  const response = await fetch(`${GATEWAY_URL}/v1/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(agent),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(payload?.detail ?? `Agent create failed (${response.status}).`);
  }
  return (await response.json()) as { id: string };
}

export async function resolvePermission(
  permissionId: string,
  allowed: boolean,
): Promise<void> {
  const response = await fetch(
    `${GATEWAY_URL}/v1/permissions/${encodeURIComponent(permissionId)}`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ allowed }),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(payload?.detail ?? `Permission failed (${response.status}).`);
  }
}

export async function* streamResponse(
  payload: {
    instructions: string;
    input: InputItem[];
    memo_agent?: AgentConfig;
  },
  signal?: AbortSignal,
): AsyncGenerator<GatewayEvent> {
  const response = await fetch(`${GATEWAY_URL}/v1/responses`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      model: "codex",
      instructions: payload.instructions,
      input: payload.input,
      stream: true,
      ...(payload.memo_agent ? { memo_agent: payload.memo_agent } : {}),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response
      .json()
      .then((body) => (body as { detail?: string })?.detail)
      .catch(() => undefined);
    throw new Error(detail ?? `Gateway request failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            yield JSON.parse(data) as GatewayEvent;
          } catch {
            // Ignore malformed SSE payloads.
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
