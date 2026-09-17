import type { Grade, Material, Role } from "@circular-city/contracts";
import type { GameSnapshot, MaterialTransfer, Transport } from "./city/types";

type CommandResponse = {
  teamRevision?: number;
  serverTime?: number;
  result?: any;
};

const applyRevision = (snapshot: GameSnapshot, response: CommandResponse): void => {
  if (typeof response.teamRevision === "number")
    snapshot.team.revision = Math.max(snapshot.team.revision, response.teamRevision);
};

export function applyCommandReceiptPatch(
  current: GameSnapshot,
  path: string,
  payload: Record<string, any>,
  response: CommandResponse,
): GameSnapshot | null {
  const result = response.result;
  if (!result) return null;
  const next = structuredClone(current) as GameSnapshot;

  if (path.endsWith("/municipality/collections") && result.transport) {
    const transport = result.transport as Transport;
    next.team.wasteSources = next.team.wasteSources.map((source) =>
      source._id === result.wasteSourceId
        ? { ...source, status: "in_transit" as const, transitArrivesAt: transport.arrivesAt }
        : source,
    );
    next.team.transports = [
      ...next.team.transports.filter((entry) => entry.wasteSourceId !== result.wasteSourceId),
      transport,
    ];
    next.team.walletCents -= result.costCents;
    next.team.totalCO2Kg += result.co2Kg;
    applyRevision(next, response);
    return next;
  }

  if (path.endsWith("/broker/external-purchases")) {
    const material = result.material as Material;
    const quantityKg = Number(result.quantityKg ?? 0);
    if (!material || quantityKg <= 0) return null;
    next.team.walletCents -= result.costCents;
    next.team.totalCO2Kg += result.co2Kg;
    next.team.inventory[material].B += quantityKg;
    next.team.roleInventories.broker[material].B += quantityKg;
    applyRevision(next, response);
    return next;
  }

  if (path.endsWith("/mrf/quality-upgrades") && result.qualityUpgrade?._id) {
    const qualityUpgrade = result.qualityUpgrade as {
      _id: string;
      materialType: Material;
      result: {
        inputKg: number;
        costCents: number;
        co2Kg: number;
      };
    };
    const calculation = qualityUpgrade.result ?? result.calculation;
    const inputKg = Number(calculation?.inputKg ?? 0);
    if (!qualityUpgrade.materialType || inputKg <= 0 || !calculation) return null;
    const activeUpgrades = next.team.activeQualityUpgrades ?? [];
    if (!activeUpgrades.some((entry) => entry._id === qualityUpgrade._id)) {
      next.team.inventory[qualityUpgrade.materialType].C -= inputKg;
      next.team.roleInventories.mrf[qualityUpgrade.materialType].C -= inputKg;
      next.team.walletCents -= Number(calculation.costCents ?? 0);
      next.team.totalCO2Kg += Number(calculation.co2Kg ?? 0);
      next.team.activeQualityUpgrades = [...activeUpgrades, qualityUpgrade as any];
    }
    applyRevision(next, response);
    return next;
  }

  if (path.endsWith("/material-transfers") && result.transfer) {
    const transfer = result.transfer as MaterialTransfer;
    const fromRole = transfer.fromRole as Role;
    const material = transfer.materialType as Material;
    const grade = transfer.grade as Grade;
    next.team.roleInventories[fromRole][material][grade] -= transfer.quantityKg;
    next.team.walletCents -= transfer.costCents;
    next.team.totalCO2Kg += transfer.co2Kg;
    next.team.materialTransfers = [
      ...next.team.materialTransfers.filter((entry) => entry._id !== transfer._id),
      transfer,
    ];
    applyRevision(next, response);
    return next;
  }

  if (path.endsWith("/broker/trades") && result.offer?._id) {
    const offer = result.offer;
    next.trades = [
      ...next.trades.filter((entry) => entry._id !== offer._id),
      offer,
    ];
    for (const line of offer.terms.offered.materials) {
      const material = line.materialType as Material;
      const grade = line.grade as Grade;
      next.team.inventory[material][`locked${grade}` as "lockedA" | "lockedB" | "lockedC"] += line.quantityKg;
      next.team.roleInventories.broker[material][`locked${grade}` as "lockedA" | "lockedB" | "lockedC"] += line.quantityKg;
      next.team.inventory[material].lockedKg += line.quantityKg;
      next.team.roleInventories.broker[material].lockedKg += line.quantityKg;
    }
    applyRevision(next, response);
    return next;
  }

  if (/\/health-missions\/[^/]+\/steps$/.test(path) && result.missionId) {
    const optionKey = payload.payload?.optionKey as string | undefined;
    if (!next.team.currentHealthMission || !optionKey) return null;
    next.team.currentHealthMission.steps[next.viewer.role] = { optionKey };
    if (result.completed) {
      next.team.currentHealthMission = null;
      next.team.health += Number(result.healthDelta ?? 0);
    }
    applyRevision(next, response);
    return next;
  }

  return null;
}
