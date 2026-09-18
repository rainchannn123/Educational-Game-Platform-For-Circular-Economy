import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "./city/types";
import { applyRealtimeSnapshotPatch } from "./gameSnapshotCache";

const inventory = () => ({
  paper: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
  plastic: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
  metal: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
  glass: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
  wood: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
});

const snapshot = (): GameSnapshot => {
  const mrfStock = inventory();
  const brokerStock = inventory();
  const municipalityStock = inventory();
  return {
    game: { id: "game", status: "active", serverTime: 1, revision: 1 },
    viewer: { userId: "user", teamId: "team", role: "municipality" },
    team: {
      teamId: "team",
      citySlot: 1,
      walletCents: 0,
      health: 100,
      totalCO2Kg: 0,
      rewardMultiplierBasisPoints: 10_000,
      revision: 1,
      inventory: inventory(),
      roleInventories: { municipality: municipalityStock, mrf: mrfStock, broker: brokerStock },
      wasteSources: [
        { _id: "waste-1", massKg: 100, compositionKg: { paper: 100, plastic: 0, metal: 0, glass: 0, wood: 0 }, contaminationBasisPoints: 0, status: "in_transit", expiresAt: 100 },
        { _id: "stream-1", massKg: 20, compositionKg: { paper: 20, plastic: 0, metal: 0, glass: 0, wood: 0 }, contaminationBasisPoints: 0, status: "processing", expiresAt: 100 },
      ],
      activeJobs: [{ _id: "job-1", wasteSourceId: "stream-1", methodId: "paper-hydropulp-deink", dueAt: 100, status: "processing" }],
      transports: [{ _id: "transport-1", wasteSourceId: "waste-1", route: "standard", arrivesAt: 100, status: "in_transit" }],
      materialTransfers: [{ _id: "transfer-1", fromRole: "mrf", toRole: "broker", materialType: "paper", grade: "A", quantityKg: 5, route: "standard", costCents: 0, co2Kg: 0, departedAt: 1, arrivesAt: 100, status: "in_transit" }],
      currentHealthMission: null,
    },
    projects: { preview: [], active: [], queued: [], recentlyClosed: [] },
    teamProjectWork: [],
    trades: [],
    chatMessages: [],
    globalChatMessages: [],
    announcements: [],
    publicLeaderboard: [],
  };
};

describe("selective game snapshot cache updates", () => {
  it("appends a team chat message without a full snapshot", () => {
    const next = applyRealtimeSnapshotPatch(snapshot(), "chat.message.created", {
      _id: "chat-1", channel: "team", senderUserId: "user", senderRole: "municipality", content: "MRF batch is on the way.", createdAtMs: 10,
    });
    expect(next?.chatMessages).toHaveLength(1);
    expect(next?.chatMessages[0]?.content).toBe("MRF batch is on the way.");
  });

  it("appends and deduplicates a private logistics announcement", () => {
    const payload = {
      announcement: {
        _id: "logistics-1",
        key: "transfer-1:arrival",
        type: "logistics" as const,
        message: "Broker has sent you 1.0 t metal (Grade B) into your inventory. Please check.",
        createdAtMs: 10,
      },
    };
    const next = applyRealtimeSnapshotPatch(
      snapshot(),
      "announcement.created",
      payload,
    );
    const duplicate = applyRealtimeSnapshotPatch(
      next!,
      "announcement.created",
      payload,
    );
    expect(duplicate?.announcements).toEqual([payload.announcement]);
  });

  it("moves an arrived source from Municipality transit to the MRF cache", () => {
    const next = applyRealtimeSnapshotPatch(snapshot(), "municipality.transport.updated", { wasteSourceId: "waste-1", status: "at_mrf" });
    expect(next?.team.transports).toHaveLength(0);
    expect(next?.team.wasteSources[0]?.status).toBe("at_mrf");
  });

  it("credits the destination role allocation when a material transfer arrives", () => {
    const next = applyRealtimeSnapshotPatch(snapshot(), "material.transfer.updated", { transferId: "transfer-1", status: "completed", toRole: "broker", material: "paper", grade: "A", quantityKg: 5 });
    expect(next?.team.materialTransfers).toHaveLength(0);
    expect(next?.team.roleInventories.broker.paper.A).toBe(5);
  });

  it("removes a completed MRF job and credits recovered material", () => {
    const next = applyRealtimeSnapshotPatch(snapshot(), "mrf.processing.updated", { wasteSourceId: "stream-1", status: "completed", result: { outputKg: { paper: 12 }, grade: "A" } });
    expect(next?.team.activeJobs).toHaveLength(0);
    expect(next?.team.wasteSources).toHaveLength(1);
    expect(next?.team.inventory.paper.A).toBe(12);
    expect(next?.team.roleInventories.mrf.paper.A).toBe(12);
  });

  it("shows a newly started recycle or landfill job immediately", () => {
    const current = snapshot();
    current.team.wasteSources = current.team.wasteSources.filter(
      (source) => source._id !== "stream-1",
    );
    current.team.wasteSources.push({
      _id: "stream-2",
      massKg: 20,
      compositionKg: { paper: 20, plastic: 0, metal: 0, glass: 0, wood: 0 },
      contaminationBasisPoints: 0,
      status: "held",
      expiresAt: 100,
    });
    const next = applyRealtimeSnapshotPatch(current, "mrf.processing.updated", {
      wasteSourceId: "stream-2",
      methodId: "landfill",
      dueAt: 120,
      status: "processing",
      jobId: "job-2",
    });
    expect(next?.team.wasteSources.find((source) => source._id === "stream-2")?.status).toBe("processing");
    expect(next?.team.activeJobs.find((job) => job.wasteSourceId === "stream-2")?.methodId).toBe("landfill");
  });

  it("reserves Grade C at upgrade start and credits Grade B only on completion", () => {
    const current = snapshot();
    current.team.inventory.plastic.C = 1_000;
    current.team.roleInventories.mrf.plastic.C = 1_000;
    const started = applyRealtimeSnapshotPatch(
      current,
      "mrf.quality-upgrade.updated",
      {
        qualityUpgradeId: "upgrade-1",
        materialType: "plastic",
        dueAt: 120,
        status: "processing",
        teamRevision: 2,
        result: {
          material: "plastic",
          inputGrade: "C",
          targetGrade: "B",
          inputKg: 1_000,
          outputKg: 700,
          residueKg: 300,
          durationMs: 12_000,
          costCents: 5_000,
          co2Kg: 90,
          recoveryRateBasisPoints: 7_000,
        },
      },
    );
    expect(started?.team.inventory.plastic.C).toBe(0);
    expect(started?.team.roleInventories.mrf.plastic.C).toBe(0);
    expect(started?.team.activeQualityUpgrades).toHaveLength(1);

    const completed = applyRealtimeSnapshotPatch(
      started!,
      "mrf.quality-upgrade.updated",
      {
        qualityUpgradeId: "upgrade-1",
        materialType: "plastic",
        status: "completed",
        teamRevision: 3,
        result: { outputKg: 700 },
      },
    );
    expect(completed?.team.activeQualityUpgrades).toHaveLength(0);
    expect(completed?.team.inventory.plastic.B).toBe(700);
    expect(completed?.team.roleInventories.mrf.plastic.B).toBe(700);
  });
});
