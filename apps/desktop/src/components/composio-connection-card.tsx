import { CheckCircle2Icon, ExternalLinkIcon } from "lucide-react";
import { ComposioIcon } from "@/components/composio-icon";
import { Button } from "@/components/ui/button";

export function ComposioConnectionCard({
  id,
  label,
  icon,
  accounts,
  configured,
  busy,
  onConnect,
  onDisconnect,
}: Readonly<{
  id: string;
  label: string;
  icon?: string;
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
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background">
            {icon ? (
              <img
                src={icon}
                alt=""
                className="size-5 object-contain"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                  event.currentTarget.nextElementSibling?.removeAttribute("hidden");
                }}
              />
            ) : null}
            <span hidden={Boolean(icon)}>
              <ComposioIcon toolkit={id} />
            </span>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{label}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {active && <CheckCircle2Icon className="size-3 text-primary" />}
              {active
                ? "Connected"
                : accounts.length
                  ? "Needs attention"
                  : "Not connected"}
            </p>
          </div>
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
