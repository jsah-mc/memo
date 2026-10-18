export const isActiveComposioStatus = (status: string) =>
  ["ACTIVE", "CONNECTED", "ENABLED", "SUCCESS"].includes(
    status.trim().split(".").at(-1)?.toUpperCase() ?? "",
  );
