import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  RefreshCwIcon,
} from "lucide-react";
import { COMPOSIO_TOOLKITS } from "@/agents/composio-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ComposioPanel() {
  const [configured, setConfigured] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] =
    useState<readonly { id: string; label: string }[]>(COMPOSIO_TOOLKITS);
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
      const [status, keyStatus] = await Promise.all([
        window.desktopApi.getComposioStatus(),
        window.desktopApi.getComposioKeyStatus(),
      ]);
      setConfigured(status.configured);
      setHasKey(keyStatus.hasKey);
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

  const save = async () => {
    setBusy("key");
    setError("");
    try {
      await window.desktopApi.setComposioKey(key.trim());
      setKey("");
      await refresh();
      setCatalogRevision((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save API key.",
      );
    } finally {
      setBusy(null);
    }
  };
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
  }));
  const allApps = Array.from(
    new Map([...connected, ...catalog].map((item) => [item.id, item])).values(),
  );
  const visible = allApps.filter((toolkit) =>
    toolkit.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-xl bg-muted/35 p-3">
        <div>
          <p className="text-sm font-medium">Composio API key</p>
          <p className="text-xs text-muted-foreground">
            Used by the gateway for your shared app connections.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="Composio API key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={hasKey ? "Replace saved key" : "Enter API key"}
          />
          <Button
            type="button"
            disabled={!key.trim() || busy !== null}
            onClick={() => void save()}
          >
            {busy === "key" ? "Saving…" : "Save"}
          </Button>
        </div>
      </section>
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
        <div className="grid max-h-64 gap-2 overflow-y-auto">
          {visible.map((toolkit) => {
            const accounts = connections.filter(
              (item) => item.toolkit === toolkit.id,
            );
            const active = accounts.some((item) => item.status === "ACTIVE");
            return (
              <div key={toolkit.id} className="rounded-xl bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{toolkit.label}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {active && (
                        <CheckCircle2Icon className="size-3 text-primary" />
                      )}
                      {active
                        ? "Connected"
                        : accounts.length
                          ? "Needs attention"
                          : "Not connected"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!configured || busy !== null}
                    onClick={() => void connect(toolkit.id)}
                  >
                    {busy === toolkit.id
                      ? "Opening…"
                      : active
                        ? "Add account"
                        : accounts.length
                          ? "Reconnect"
                          : "Connect"}
                    <ExternalLinkIcon className="size-3" />
                  </Button>
                </div>
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span>
                      {account.status.toLowerCase().replaceAll("_", " ")} ·{" "}
                      {account.id.slice(-8)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => void disconnect(account.id)}
                    >
                      {busy === account.id ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}
          {!visible.length && (
            <p className="text-xs text-muted-foreground">No matching apps.</p>
          )}
        </div>
        {!configured && !loading && (
          <p className="text-xs text-muted-foreground">
            Save a Composio API key to connect apps. You can also do this later
            in Settings.
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
