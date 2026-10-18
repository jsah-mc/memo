import { useEffect, useState } from "react";
import type { CLIBackendId } from "@/agents/cli-options";

let cached: Partial<Record<CLIBackendId, readonly string[]>> = {};
let pending: Promise<AgentBackendData[]> | undefined;

const load = () => {
  pending ??= window.desktopApi.agents.backends().finally(() => {
    pending = undefined;
  });
  return pending;
};

export function useRuntimeModels() {
  const [models, setModels] = useState(cached);

  useEffect(() => {
    let active = true;
    void load()
      .then((backends) => {
        cached = Object.fromEntries(
          backends.map((backend) => [backend.id, backend.models ?? []]),
        ) as Partial<Record<CLIBackendId, readonly string[]>>;
        if (active) setModels(cached);
      })
      .catch(() => {
        if (active) setModels(cached);
      });
    return () => {
      active = false;
    };
  }, []);

  return models;
}
