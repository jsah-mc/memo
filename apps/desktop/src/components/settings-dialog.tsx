import { SettingsIcon } from "lucide-react";
import { ComposioPanel } from "@/components/composio-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            className="h-9 w-full justify-start gap-2.5 px-2.5"
            aria-label="Open settings"
          />
        }
      >
        <SettingsIcon className="size-4" /> Settings
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Connect apps once and choose which integrations each agent can use.
          </DialogDescription>
        </DialogHeader>
        <ComposioPanel />
      </DialogContent>
    </Dialog>
  );
}
