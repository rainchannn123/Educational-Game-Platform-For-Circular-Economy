import type { Material } from "@circular-city/contracts";

export const materialIconText: Record<Material, string> = {
  paper: "P",
  plastic: "PL",
  metal: "M",
  glass: "G",
  wood: "W",
};
export const statusLabel = (
  state: "active" | "queued" | "claimed" | "expired",
): string =>
  ({
    active: "Active",
    queued: "Queued",
    claimed: "Completed",
    expired: "Expired",
  })[state];
