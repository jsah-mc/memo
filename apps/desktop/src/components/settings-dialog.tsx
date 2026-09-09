import { useEffect, useState } from "react";
import { CheckCircle2Icon, ExternalLinkIcon, PlugIcon, ServerIcon, SettingsIcon } from "lucide-react";
import { COMPOSIO_TOOLKITS } from "@/agents/composio-options";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ServiceState = "checking" | "ready" | "missing" | "offline";

function settingsError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes("No handler registered for 'composio:")) {
    return "Restart Memo once to finish enabling the new Composio settings.";
  }
  return message || fallback;
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [gateway, setGateway] = useState<ServiceState>("checking");
  const [composio, setComposio] = useState<ServiceState>("checking");
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setGateway("checking"); setComposio("checking"); setError("");
    void Promise.all([
      window.desktopApi.getGatewayStatus().then((value) => setGateway(value.running ? "ready" : "offline")).catch(() => setGateway("offline")),
      window.desktopApi.getComposioStatus().then((value) => setComposio(value.configured ? "ready" : "missing")).catch(() => setComposio("offline")),
      window.desktopApi.getComposioKeyStatus().then((value) => setHasKey(value.hasKey)),
    ]);
  }, [open]);

  const saveKey = async () => {
    if (!key.trim()) return;
    setSaving(true); setError("");
    try {
      await window.desktopApi.setComposioKey(key);
      setKey(""); setHasKey(true); setComposio("ready");
    } catch (reason) { setError(settingsError(reason, "Could not save the key.")); }
    finally { setSaving(false); }
  };

  const connect = async (toolkit: string) => {
    setConnecting(toolkit); setError("");
    try { await window.desktopApi.authorizeComposio(toolkit); }
    catch (reason) { setError(settingsError(reason, "Could not open sign in.")); }
    finally { setConnecting(null); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" className="h-9 w-full justify-start gap-2.5 px-2.5" aria-label="Open settings" />}><SettingsIcon className="size-4" /> Settings</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Settings</DialogTitle><DialogDescription>Manage Memo services and shared integrations.</DialogDescription></DialogHeader>
        <div className="grid gap-2">
          <Service icon={<ServerIcon className="size-4" />} name="Memo gateway" description="Local agent and tool backend" state={gateway} />
          <Service icon={<PlugIcon className="size-4" />} name="Composio" description="Shared app connections" state={composio} />

          <section className="mt-2 grid gap-3 rounded-xl bg-muted/35 p-3">
            <div><p className="text-sm font-medium">Composio API key</p><p className="text-xs text-muted-foreground">Stored locally using your operating system's encryption.</p></div>
            <div className="flex gap-2">
              <Input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={hasKey ? "Key saved - enter a new key to replace it" : "Enter API key"} />
              <Button type="button" onClick={() => void saveKey()} disabled={!key.trim() || saving}>{saving ? "Saving..." : "Save"}</Button>
            </div>
          </section>

          <section className="mt-2 grid gap-3 rounded-xl bg-muted/35 p-3">
            <div><p className="text-sm font-medium">Connected apps</p><p className="text-xs text-muted-foreground">Sign in once and every Memo agent can reuse the connection.</p></div>
            <div className="grid grid-cols-2 gap-2">
              {COMPOSIO_TOOLKITS.map((toolkit) => (
                <Button key={toolkit.id} type="button" variant="outline" className="justify-between" disabled={!hasKey || connecting !== null} onClick={() => void connect(toolkit.id)}>
                  {connecting === toolkit.id ? "Opening..." : toolkit.label}<ExternalLinkIcon className="size-3.5" />
                </Button>
              ))}
            </div>
            {!hasKey && <p className="text-xs text-muted-foreground">Save your API key before connecting an app.</p>}
          </section>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <section className="mt-2 grid gap-1 rounded-xl bg-muted/35 p-3"><p className="text-xs font-medium">Appearance</p><p className="text-xs text-muted-foreground">Dark green theme - follows Memo's current desktop design.</p></section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Service({ icon, name, description, state }: Readonly<{ icon: React.ReactNode; name: string; description: string; state: ServiceState }>) {
  return <section className="flex items-center gap-3 rounded-xl bg-muted/60 p-3"><span className="flex size-9 items-center justify-center rounded-lg bg-background">{icon}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">{description}</p></div><Status state={state} /></section>;
}

function Status({ state }: Readonly<{ state: ServiceState }>) {
  if (state === "checking") return <span className="text-xs text-muted-foreground">Checking...</span>;
  if (state === "ready") return <span className="flex items-center gap-1 text-xs text-primary"><CheckCircle2Icon className="size-3.5" /> Ready</span>;
  return <span className="text-xs text-muted-foreground">{state === "missing" ? "Not configured" : "Offline"}</span>;
}
