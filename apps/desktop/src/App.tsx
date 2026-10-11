import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RouterProvider } from "react-router/dom";
import { router } from "@/routes";

type UpdateStatus = {
  available: boolean;
  version?: string;
  notes?: string;
};

function UpdateController() {
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const timer = window.setTimeout(async () => {
      try {
        const update = await invoke<UpdateStatus>("update_check");
        if (
          update.available &&
          window.confirm(
            `Memo ${update.version ?? "update"} is available. Download and install it now?`,
          )
        ) {
          await invoke("update_install");
          window.alert(
            "The update is installed. Restart Memo if it does not reopen automatically.",
          );
        }
      } catch (error) {
        console.warn("Memo update check failed", error);
      }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}

export default function App() {
  return (
    <>
      <UpdateController />
      <RouterProvider router={router} />
    </>
  );
}
