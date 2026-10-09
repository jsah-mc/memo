import { CheckCircle2Icon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ComposioConnectionCard({
  id,
  label,
  accounts,
  configured,
  busy,
  onConnect,
  onDisconnect,
}: Readonly<{
  id: string;
  label: string;
  accounts: ComposioConnection[];
  configured: boolean;
  busy: string | null;
  onConnect: (toolkit: string) => void;
  onDisconnect: (connectionId: string) => void;
}>) {
  const active = accounts.some((item) => item.status === "ACTIVE");
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {active && <CheckCircle2Icon className="size-3 text-primary" />}
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
          onClick={() => onConnect(id)}
        >
          {busy === id
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
            onClick={() => onDisconnect(account.id)}
          >
            {busy === account.id ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      ))}
    </div>
  );
}
