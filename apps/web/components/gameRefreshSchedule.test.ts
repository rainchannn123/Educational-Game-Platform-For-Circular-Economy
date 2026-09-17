import { describe, expect, it } from "vitest";
import type { ProjectTemplate } from "@circular-city/game-content";
import type { GameSnapshot } from "./city/types";
import { nextAuthoritativeRefresh } from "./gameRefreshSchedule";

const snapshot = (): GameSnapshot =>
  ({
    game: {
      id: "game",
      status: "active",
      serverTime: 1_000,
      activeStartedAt: 1_000,
      activeEndsAt: 1_201_000,
      revision: 1,
    },
    viewer: { userId: "user", teamId: "team", role: "mrf" },
    team: {
      teamId: "team",
      citySlot: 1,
      walletCents: 0,
      health: 100,
      totalCO2Kg: 0,
      rewardMultiplierBasisPoints: 10_000,
      revision: 1,
      inventory: {},
      roleInventories: {},
      wasteSources: [],
      activeJobs: [],
      transports: [],
      materialTransfers: [],
      currentHealthMission: null,
    },
    projects: { preview: [], active: [], queued: [], recentlyClosed: [] },
    teamProjectWork: [],
    trades: [],
    chatMessages: [],
    globalChatMessages: [],
    announcements: [],
    publicLeaderboard: [],
  }) as unknown as GameSnapshot;

describe("authoritative refresh schedule", () => {
  it("refreshes at the first quiz boundary and retries during a missing quiz window", () => {
    const data = snapshot();
    expect(nextAuthoritativeRefresh(data, 20_000)).toMatchObject({
      at: 31_000,
      reason: "quiz-window",
    });
    expect(nextAuthoritativeRefresh(data, 32_000)).toMatchObject({
      at: 33_000,
      reason: "quiz-window",
    });
  });

  it("prioritizes known timed state changes over later quiz windows", () => {
    const data = snapshot();
    data.team.activeJobs = [
      {
        _id: "job",
        wasteSourceId: "stream",
        methodId: "landfill",
        dueAt: 24_000,
        status: "processing",
      },
    ];
    data.team.transports = [
      {
        _id: "transport",
        wasteSourceId: "waste",
        route: "standard",
        arrivesAt: 26_000,
        status: "in_transit",
      },
    ];
    data.trades = [
      {
        _id: "offer",
        offeringTeamId: "other",
        recipientTeamId: "team",
        status: "open",
        expiresAt: 25_000,
        terms: { offered: { materials: [], cashCents: 0 }, requested: { materials: [], cashCents: 0 }, deliveryMode: "standard" },
      },
    ];

    expect(nextAuthoritativeRefresh(data, 20_000)).toMatchObject({
      at: 24_000,
      reason: "mrf-processing",
    });
  });

  it("refreshes when an MRF quality upgrade reaches its authoritative deadline", () => {
    const data = snapshot();
    data.team.activeQualityUpgrades = [
      {
        _id: "upgrade",
        materialType: "glass",
        inputGrade: "C",
        targetGrade: "B",
        dueAt: 22_000,
        status: "processing",
        result: {
          material: "glass",
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
    ];
    expect(nextAuthoritativeRefresh(data, 20_000)).toMatchObject({
      at: 22_000,
      reason: "mrf-quality-upgrade",
    });
  });

  it("refreshes at project activation and quiz expiry boundaries", () => {
    const data = snapshot();
    data.team.currentHealthMission = {
      _id: "mission",
      templateId: "Q01",
      status: "active",
      expiresAt: 40_000,
      steps: {},
    };
    data.projects.preview = [
      {
        _id: "project",
        sequence: 1,
        status: "announced",
        activeAt: 35_000,
        template: {} as ProjectTemplate,
      },
    ];

    expect(nextAuthoritativeRefresh(data, 32_000)).toMatchObject({
      at: 35_000,
      reason: "project-transition",
    });
  });
});
