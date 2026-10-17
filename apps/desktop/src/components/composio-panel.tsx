import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { COMPOSIO_TOOLKITS } from "@/agents/composio-options";
import { ComposioConnectionCard } from "@/components/composio-connection-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ComposioPanel() {
  const [configured, setConfigured] = useState(false);
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] =
    useState<readonly { id: string; label: string; icon?: string }[]>(COMPOSIO_TOOLKITS);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pollUntil, setPollUntil] = useState(0);
  const pendingToolkit = useRef<string | null>(null);
  const previousAccounts = useRef(new Set<string>());
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await window.desktopApi.getComposioStatus();
      setConfigured(status.configured);
      const result = status.configured
        ? await window.desktopApi.getComposioConnections()
        : { data: [] };
      setConnections(result.data);
      setError("");
      if (
        pendingToolkit.current &&
        result.data.some(
          (item) =>
            item.toolkit === pendingToolkit.current &&
            item.status === "ACTIVE" &&
            !previousAccounts.current.has(item.id),
        )
      ) {
        pendingToolkit.current = null;
        setPollUntil(0);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load app connections.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  useEffect(() => {
    if (!pollUntil) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= pollUntil) {
        setPollUntil(0);
        return;
      }
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pollUntil, refresh]);

  useEffect(() => {
    if (!configured) {
      setCatalog(COMPOSIO_TOOLKITS);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.desktopApi
        .getComposioToolkits(search.trim())
        .then((result) => {
          if (!cancelled) {
            setCatalog(result.data);
            setCatalogError("");
          }
        })
        .catch((reason: unknown) => {
          if (!cancelled)
            setCatalogError(
              reason instanceof Error
                ? reason.message
                : "Could not search integrations.",
            );
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [configured, search, catalogRevision]);

  const connect = async (toolkit: string) => {
    setBusy(toolkit);
    setError("");
    try {
      previousAccounts.current = new Set(
        connections
          .filter((item) => item.status === "ACTIVE")
          .map((item) => item.id),
      );
      await window.desktopApi.authorizeComposio(toolkit);
      pendingToolkit.current = toolkit;
      setPollUntil(Date.now() + 120_000);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not open sign in.",
      );
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await window.desktopApi.disconnectComposio(id);
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not disconnect app.",
      );
    } finally {
      setBusy(null);
    }
  };

  const connected = connections.map((item) => ({
    id: item.toolkit,
    label:
      COMPOSIO_TOOLKITS.find((toolkit) => toolkit.id === item.toolkit)?.label ??
      item.toolkit.replaceAll("_", " "),
    icon:
      catalog.find((toolkit) => toolkit.id === item.toolkit)?.icon ??
      `https://logos.composio.dev/api/${encodeURIComponent(item.toolkit)}`,
  }));
  const allApps = Array.from(
    new Map([...connected, ...catalog].map((item) => [item.id, item])).values(),
  );
  const visible = allApps.filter((toolkit) =>
    toolkit.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="grid gap-4">
      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">App connections</p>
            <p className="text-xs text-muted-foreground">
              Agents can use the apps you allow for them.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh app connections"
            disabled={loading}
            onClick={() => {
              void refresh();
              setCatalogRevision((value) => value + 1);
            }}
          >
            <RefreshCwIcon
              className={`size-4 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
        <Input
          aria-label="Search app integrations"
          placeholder="Search apps…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {visible.map((toolkit) => {
            const accounts = connections.filter(
              (item) => item.toolkit === toolkit.id,
            );
            return (
              <ComposioConnectionCard
                key={toolkit.id}
                id={toolkit.id}
                label={toolkit.label}
                icon={toolkit.icon}
                accounts={accounts}
                configured={configured}
                busy={busy}
                onConnect={(id) => void connect(id)}
                onDisconnect={(id) => void disconnect(id)}
              />
            );
          })}
          {!visible.length && (
            <p className="text-xs text-muted-foreground">No matching apps.</p>
          )}
        </div>
        {!configured && !loading && (
          <p className="text-xs text-muted-foreground">
            Add a Composio API key in Settings → API keys to connect apps.
          </p>
        )}
        {pollUntil > 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            Finish signing in in your browser. Waiting for the connection…
          </p>
        )}
      </section>
      {catalogError && (
        <p role="alert" className="text-xs text-destructive">
          {catalogError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
