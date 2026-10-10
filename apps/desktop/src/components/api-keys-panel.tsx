import { useEffect, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ApiKeysPanel() {
  const [composioKey, setComposioKey] = useState("");
  const [hasComposioKey, setHasComposioKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void window.desktopApi
      .getComposioKeyStatus()
      .then((status) => setHasComposioKey(status.hasKey))
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "Could not read API key status.",
        ),
      );
  }, []);

  const saveComposio = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await window.desktopApi.setComposioKey(composioKey.trim());
      setComposioKey("");
      setHasComposioKey(true);
      setMessage("Composio API key saved securely.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save API key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
        <div className="mb-3 flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background">
            <KeyRoundIcon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Composio</p>
            <p className="text-xs text-muted-foreground">
              Used to discover integrations, authorize accounts, and run connected-app tools.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="Composio API key"
            type="password"
            autoComplete="off"
            value={composioKey}
            onChange={(event) => setComposioKey(event.target.value)}
            placeholder={hasComposioKey ? "Saved — enter a replacement" : "Enter Composio API key"}
          />
          <Button
            type="button"
            disabled={!composioKey.trim() || busy}
            onClick={() => void saveComposio()}
          >
            {busy ? "Saving…" : hasComposioKey ? "Replace" : "Save"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Keys are encrypted with the operating system credential store before being written to disk.
      </p>
      {message && <p role="status" className="text-xs text-primary">{message}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
