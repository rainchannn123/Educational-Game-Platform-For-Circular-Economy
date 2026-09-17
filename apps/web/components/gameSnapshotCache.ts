import type {
  Grade,
  Material,
  ProcessingMethodId,
  Role,
} from "@circular-city/contracts";
import type { ChatMessage, GameAnnouncement, GameSnapshot } from "./city/types";

type RealtimePayload = Record<string, any>;

const appendUnique = <T extends { _id: string }>(
  entries: T[],
  entry: T,
  limit: number,
): T[] => [...entries.filter((current) => current._id !== entry._id), entry].slice(-limit);

const addRecoveredOutput = (
  snapshot: GameSnapshot,
  outputKg: Record<string, number>,
  grade: Grade | null,
): void => {
  if (!grade) return;
  for (const material of Object.keys(outputKg) as Material[]) {
    const quantityKg = outputKg[material] ?? 0;
    if (quantityKg <= 0) continue;
    snapshot.team.inventory[material][grade] += quantityKg;
    snapshot.team.roleInventories.mrf[material][grade] += quantityKg;
  }
};

export function applyRealtimeSnapshotPatch(
  current: GameSnapshot,
  eventName: string,
  payload: RealtimePayload,
): GameSnapshot | null {
  const next = structuredClone(current) as GameSnapshot;
  if (eventName === "chat.message.created") {
    const message = payload as ChatMessage & { channel?: string };
    if (!message._id || !message.channel) return null;
    if (message.channel === "team") {
      next.chatMessages = appendUnique(next.chatMessages, message, 50);
      return next;
    }
    if (message.channel === "global") {
      next.globalChatMessages = appendUnique(next.globalChatMessages, message, 100);
      return next;
    }
    return null;
  }
  if (eventName === "announcement.created") {
    const announcement = payload.announcement as GameAnnouncement | undefined;
    if (!announcement?._id) return null;
    next.announcements = appendUnique(next.announcements, announcement, 50);
    return next;
  }
  if (eventName === "municipality.transport.updated" && payload.status === "at_mrf") {
    const wasteSourceId = String(payload.wasteSourceId ?? "");
    if (!wasteSourceId) return null;
    next.team.transports = next.team.transports.filter(
      (transport) => transport.wasteSourceId !== wasteSourceId,
    );
    next.team.wasteSources = next.team.wasteSources.map((source) =>
      source._id === wasteSourceId
        ? { ...source, status: "at_mrf" as const, queueArrivedAt: Date.now() }
        : source,
    );
    return next;
  }
  if (eventName === "material.transfer.updated" && payload.status === "completed") {
    const transferId = String(payload.transferId ?? "");
    const toRole = payload.toRole as Role | undefined;
    const material = payload.material as Material | undefined;
    const grade = payload.grade as Grade | undefined;
    const quantityKg = Number(payload.quantityKg ?? 0);
    if (!transferId || !toRole || !material || !grade || quantityKg <= 0) return null;
    next.team.materialTransfers = next.team.materialTransfers.filter(
      (transfer) => transfer._id !== transferId,
    );
    next.team.roleInventories[toRole][material][grade] += quantityKg;
    return next;
  }
  if (eventName === "mrf.processing.updated" && payload.status === "completed") {
    const wasteSourceId = String(payload.wasteSourceId ?? "");
    const result = payload.result as
      | { outputKg?: Record<string, number>; grade?: Grade | null }
      | undefined;
    if (!wasteSourceId || !result?.outputKg) return null;
    next.team.activeJobs = next.team.activeJobs.filter(
      (job) => job.wasteSourceId !== wasteSourceId,
    );
    next.team.wasteSources = next.team.wasteSources.filter(
      (source) => source._id !== wasteSourceId,
    );
    addRecoveredOutput(next, result.outputKg, result.grade ?? null);
    return next;
  }
  if (eventName === "mrf.processing.updated" && payload.status === "processing") {
    const wasteSourceId = String(payload.wasteSourceId ?? "");
    const methodId = payload.methodId as ProcessingMethodId | undefined;
    const dueAt = Number(payload.dueAt ?? 0);
    if (!wasteSourceId || !methodId || !dueAt) return null;
    next.team.wasteSources = next.team.wasteSources.map((source) =>
      source._id === wasteSourceId
        ? { ...source, status: "processing" as const }
        : source,
    );
    next.team.activeJobs = [
      ...next.team.activeJobs.filter((job) => job.wasteSourceId !== wasteSourceId),
      {
        _id: String(payload.jobId ?? `pending-${wasteSourceId}`),
        wasteSourceId,
        methodId,
        dueAt,
        status: "processing",
      },
    ];
    const calculation = payload.result as
      | { processingCostCents?: number; processingCO2Kg?: number }
      | undefined;
    if (calculation) {
      next.team.walletCents -= calculation.processingCostCents ?? 0;
      next.team.totalCO2Kg += calculation.processingCO2Kg ?? 0;
    }
    if (typeof payload.teamRevision === "number")
      next.team.revision = Math.max(next.team.revision, payload.teamRevision);
    return next;
  }
  if (
    eventName === "mrf.quality-upgrade.updated" &&
    payload.status === "processing"
  ) {
    const qualityUpgradeId = String(payload.qualityUpgradeId ?? "");
    const material = payload.materialType as Material | undefined;
    const result = payload.result as
      | {
          inputKg?: number;
          costCents?: number;
          co2Kg?: number;
          inputGrade?: "C";
          targetGrade?: "B";
        }
      | undefined;
    const dueAt = Number(payload.dueAt ?? 0);
    if (!qualityUpgradeId || !material || !result || result.inputKg == null || !dueAt)
      return null;
    const activeUpgrades = next.team.activeQualityUpgrades ?? [];
    if (!activeUpgrades.some((entry) => entry._id === qualityUpgradeId)) {
      next.team.inventory[material].C -= result.inputKg;
      next.team.roleInventories.mrf[material].C -= result.inputKg;
      next.team.walletCents -= result.costCents ?? 0;
      next.team.totalCO2Kg += result.co2Kg ?? 0;
      next.team.activeQualityUpgrades = [
        ...activeUpgrades,
        {
          _id: qualityUpgradeId,
          materialType: material,
          inputGrade: "C",
          targetGrade: "B",
          dueAt,
          status: "processing",
          result: {
            material,
            inputGrade: "C",
            targetGrade: "B",
            inputKg: result.inputKg,
            outputKg: Number((result as any).outputKg ?? 0),
            residueKg: Number((result as any).residueKg ?? 0),
            durationMs: Number((result as any).durationMs ?? 0),
            costCents: result.costCents ?? 0,
            co2Kg: result.co2Kg ?? 0,
            recoveryRateBasisPoints: Number(
              (result as any).recoveryRateBasisPoints ?? 0,
            ),
          },
        },
      ];
    }
    if (typeof payload.teamRevision === "number")
      next.team.revision = Math.max(next.team.revision, payload.teamRevision);
    return next;
  }
  if (
    eventName === "mrf.quality-upgrade.updated" &&
    payload.status === "completed"
  ) {
    const qualityUpgradeId = String(payload.qualityUpgradeId ?? "");
    const material = payload.materialType as Material | undefined;
    const result = payload.result as { outputKg?: number } | undefined;
    const outputKg = result?.outputKg;
    const activeUpgrades = next.team.activeQualityUpgrades ?? [];
    if (
      !qualityUpgradeId ||
      !material ||
      typeof outputKg !== "number" ||
      !Number.isInteger(outputKg) ||
      outputKg <= 0 ||
      !activeUpgrades.some((entry) => entry._id === qualityUpgradeId)
    )
      return null;
    next.team.activeQualityUpgrades = activeUpgrades.filter(
      (entry) => entry._id !== qualityUpgradeId,
    );
    next.team.inventory[material].B += outputKg;
    next.team.roleInventories.mrf[material].B += outputKg;
    if (typeof payload.teamRevision === "number")
      next.team.revision = Math.max(next.team.revision, payload.teamRevision);
    return next;
  }
  if (eventName === "health-mission.created") {
    const mission = payload.mission as GameSnapshot["team"]["currentHealthMission"];
    if (!mission?._id) return null;
    next.team.currentHealthMission = mission;
    return next;
  }
  if (eventName === "trade.offer.updated" && payload.offer?._id) {
    const offer = payload.offer;
    next.trades = appendUnique(next.trades as Array<{ _id: string }>, offer, 100) as any;
    return next;
  }
  if (eventName === "trade.delivery.updated" && payload.offer?._id) {
    const offer = payload.offer;
    next.trades = appendUnique(next.trades as Array<{ _id: string }>, offer, 100) as any;
    return next;
  }
  if (
    eventName === "health-mission.updated" &&
    payload.status === "expired" &&
    next.team.currentHealthMission?._id === payload.missionId
  ) {
    next.team.currentHealthMission = null;
    return next;
  }
  return null;
}
