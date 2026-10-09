import { useEffect } from "react";

export function WorkspaceShortcuts(): null {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        document
          .querySelector<HTMLTextAreaElement>('[aria-label="Message input"]')
          ?.focus();
      } else if (event.key === ",") {
        event.preventDefault();
        document
          .querySelector<HTMLButtonElement>('[aria-label="Open settings"]')
          ?.click();
      } else if (event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        document
          .querySelector<HTMLButtonElement>('[aria-label="Create agent"]')
          ?.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
