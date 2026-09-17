import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "./city/types";
import { applyCommandReceiptPatch } from "./gameCommandReceiptCache";

const inventory = () => ({
  paper: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
  plastic: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
  metal: { A: 500, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
  glass: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
  wood: { A: 0, B: 0, C: 0, lockedA: 0, lockedB: 0, lockedC: 0, lockedKg: 0 },
});

const snapshot = (): GameSnapshot => {
  const broker = inventory();
  const mrf = inventory();
  const municipality = inventory();
  return {
    game: { id: "game", status: "active", serverTime: 1, revision: 1 },
    viewer: { userId: "user", teamId: "team", role: "broker" },
    team: {
      teamId: "team", citySlot: 1, walletCents: 10_000, health: 100,
      totalCO2Kg: 10, rewardMultiplierBasisPoints: 10_000, revision: 1,
      inventory: inventory(), roleInventories: { municipality, mrf, broker },
      wasteSources: [{ _id: "waste", massKg: 100, compositionKg: { paper: 100, plastic: 0, metal: 0, glass: 0, wood: 0 }, contaminationBasisPoints: 0, status: "available", expiresAt: 100 }],
      activeJobs: [], transports: [], materialTransfers: [], currentHealthMission: null,
    },
    projects: { preview: [], active: [], queued: [], recentlyClosed: [] },
    teamProjectWork: [], trades: [], chatMessages: [], globalChatMessages: [], announcements: [], publicLeaderboard: [],
  };
};

describe("authoritative command receipt cache patches", () => {
  it("patches Municipality dispatch without a full snapshot", () => {
    const next = applyCommandReceiptPatch(
      snapshot(),
      "/v1/games/game/municipality/collections",
      { expectedTeamRevision: 1, payload: {} },
      { teamRevision: 2, result: { wasteSourceId: "waste", costCents: 400, co2Kg: 2, transport: { _id: "transport", wasteSourceId: "waste", route: "standard", arrivesAt: 50, status: "in_transit" } } },
    );
    expect(next?.team.wasteSources[0]?.status).toBe("in_transit");
    expect(next?.team.transports).toHaveLength(1);
    expect(next?.team.walletCents).toBe(9_600);
  });

  it("patches a Broker external purchase from committed receipt values", () => {
    const next = applyCommandReceiptPatch(
      snapshot(),
      "/v1/games/game/broker/external-purchases",
      { expectedTeamRevision: 1, payload: {} },
      { teamRevision: 2, result: { material: "paper", quantityKg: 100, costCents: 900, co2Kg: 3 } },
    );
    expect(next?.team.inventory.paper.B).toBe(100);
    expect(next?.team.roleInventories.broker.paper.B).toBe(100);
    expect(next?.team.walletCents).toBe(9_100);
  });

  it("patches material transfer departure without changing shared inventory", () => {
    const current = snapshot();
    current.team.roleInventories.broker.metal.A = 500;
    const next = applyCommandReceiptPatch(
      current,
      "/v1/games/game/material-transfers",
      { expectedTeamRevision: 1, payload: {} },
      { teamRevision: 2, result: { transfer: { _id: "transfer", fromRole: "broker", toRole: "mrf", materialType: "metal", grade: "A", quantityKg: 100, route: "standard", costCents: 40, co2Kg: 1, departedAt: 1, arrivesAt: 20, status: "in_transit" } } },
    );
    expect(next?.team.roleInventories.broker.metal.A).toBe(400);
    expect(next?.team.inventory.metal.A).toBe(500);
    expect(next?.team.materialTransfers).toHaveLength(1);
  });
  it("reserves Grade C immediately after an MRF quality-upgrade receipt", () => {
    const current = snapshot();
    current.team.inventory.plastic.C = 1_000;
    current.team.roleInventories.mrf.plastic.C = 1_000;
    const next = applyCommandReceiptPatch(
      current,
      "/v1/games/game/mrf/quality-upgrades",
      { expectedTeamRevision: 1, payload: {} },
      {
        teamRevision: 2,
        result: {
          qualityUpgrade: {
            _id: "upgrade",
            materialType: "plastic",
            dueAt: 20,
            status: "processing",
            inputGrade: "C",
            targetGrade: "B",
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
        },
      },
    );
    expect(next?.team.inventory.plastic.C).toBe(0);
    expect(next?.team.roleInventories.mrf.plastic.C).toBe(0);
    expect(next?.team.activeQualityUpgrades).toHaveLength(1);
    expect(next?.team.walletCents).toBe(5_000);
  });
});
