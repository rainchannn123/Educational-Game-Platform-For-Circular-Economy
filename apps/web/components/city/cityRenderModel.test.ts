import { describe, expect, it } from "vitest";
import { buildCityRenderModel } from "./cityRenderModel";
import type { GameSnapshot } from "./types";

const emptyInventory = {
  paper: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  plastic: {
    A: 0,
    B: 0,
    C: 0,
    lockedKg: 0,
    lockedA: 0,
    lockedB: 0,
    lockedC: 0,
  },
  metal: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  glass: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  wood: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
};

const snapshot: GameSnapshot = {
  game: {
    id: "game_1",
    status: "active",
    serverTime: 1_000,
    revision: 4,
  },
  viewer: { userId: "user_1", teamId: "team_1", role: "municipality" },
  team: {
    teamId: "team_1",
    citySlot: 1,
    walletCents: 1_200_000,
    health: 65,
    totalCO2Kg: 300,
    rewardMultiplierBasisPoints: 10_000,
    revision: 2,
    inventory: {
      ...emptyInventory,
      paper: { ...emptyInventory.paper, A: 700, B: 1_300 },
      metal: { ...emptyInventory.metal, B: 2_000 },
    },
    roleInventories: {
      municipality: {
        ...emptyInventory,
        paper: { ...emptyInventory.paper, A: 700, B: 1_300 },
        metal: { ...emptyInventory.metal, B: 2_000 },
      },
      mrf: { ...emptyInventory },
      broker: { ...emptyInventory },
    },
    wasteSources: [
      {
        _id: "waste_available",
        massKg: 4_000,
        compositionKg: {
          paper: 2_000,
          plastic: 1_000,
          metal: 0,
          glass: 1_000,
          wood: 0,
        },
        contaminationBasisPoints: 500,
        status: "available",
        expiresAt: 20_000,
      },
      {
        _id: "waste_transit",
        massKg: 5_000,
        compositionKg: {
          paper: 0,
          plastic: 1_000,
          metal: 3_000,
          glass: 0,
          wood: 1_000,
        },
        contaminationBasisPoints: 900,
        status: "in_transit",
        expiresAt: 20_000,
        transitArrivesAt: 7_000,
      },
      {
        _id: "waste_queue",
        massKg: 4_000,
        compositionKg: {
          paper: 2_000,
          plastic: 2_000,
          metal: 0,
          glass: 0,
          wood: 0,
        },
        contaminationBasisPoints: 1_200,
        status: "at_mrf",
        expiresAt: 20_000,
      },
    ],
    activeJobs: [
      {
        _id: "process_1",
        wasteSourceId: "waste_queue",
        methodId: "paper-hydropulp-deink",
        dueAt: 11_000,
        status: "processing",
      },
    ],
    materialTransfers: [
      {
        _id: "transfer_1",
        fromRole: "mrf",
        toRole: "municipality",
        materialType: "paper",
        grade: "B",
        quantityKg: 750,
        route: "consolidated",
        costCents: 2_100,
        co2Kg: 75,
        departedAt: 2_000,
        arrivesAt: 18_000,
        status: "in_transit",
      },
    ],
    transports: [
      {
        _id: "transport_1",
        wasteSourceId: "waste_transit",
        route: "express",
        arrivesAt: 7_000,
        status: "in_transit",
      },
    ],
    currentHealthMission: {
      _id: "health_1",
      templateId: "H01",
      status: "active",
      expiresAt: 9_000,
      steps: {},
    },
  },
  projects: {
    preview: [],
    active: [
      {
        _id: "project_2",
        sequence: 2,
        status: "active",
        template: {
          id: "P02",
          title: "School Recycling Corner",
          tier: 1,
          requirementsKg: {
            paper: 2_000,
            plastic: 1_000,
            metal: 1_000,
            glass: 0,
            wood: 0,
          },
          grossRevenueCents: 380_000,
          co2ImpactKg: -1_000,
          activeDurationMs: 75_000,
          context: "Sorting infrastructure makes recovery visible.",
        },
        expiresAt: 75_000,
      },
    ],
    queued: [],
    recentlyClosed: [],
  },
  teamProjectWork: [],
  trades: [
    {
      _id: "trade_1",
      offeringTeamId: "team_1",
      recipientTeamId: "team_2",
      status: "in-transit",
      deliveryDueAt: 8_000,
      terms: {
        offered: {
          materials: [{ materialType: "metal", grade: "B", quantityKg: 1_000 }],
          cashCents: 0,
        },
        requested: {
          materials: [
            { materialType: "paper", grade: "B", quantityKg: 1_000 },
          ],
          cashCents: 0,
        },
        deliveryMode: "low-carbon",
      },
    },
  ],
  chatMessages: [],
  globalChatMessages: [],
  announcements: [],
  publicLeaderboard: [],
};

describe("buildCityRenderModel", () => {
  it("derives authorized facility state and route details from a game snapshot", () => {
    const model = buildCityRenderModel(snapshot);

    expect(model.role).toBe("municipality");
    expect(model.inventoryKg.paper).toBe(2_000);
    expect(model.inventoryKg.metal).toBe(2_000);
    expect(model.waste).toEqual({ available: 1, queued: 1, processing: 1 });
    expect(model.transits).toEqual([
      expect.objectContaining({
        id: "waste_transit",
        kind: "collection",
        route: "express",
        arrivesAt: 7_000,
      }),
      expect.objectContaining({
        id: "process_1",
        kind: "processing",
        route: "standard",
        arrivesAt: 11_000,
      }),
      expect.objectContaining({
        id: "transfer_1",
        kind: "material-transfer",
        material: "paper",
        route: "consolidated",
        arrivesAt: 18_000,
      }),
      expect.objectContaining({
        id: "trade_1",
        kind: "trade",
        material: "metal",
        route: "low-carbon",
        arrivesAt: 8_000,
      }),
    ]);
    expect(model.projects).toEqual([
      expect.objectContaining({
        id: "project_2",
        status: "active",
        title: "School Recycling Corner",
      }),
    ]);
    expect(model.hasCityCareMission).toBe(true);
    expect(model.activeTradeCount).toBe(1);
  });
});
