import { describe, expect, it } from "vitest";
import type { ProjectTemplate } from "@circular-city/game-content";
import type { GameSnapshot } from "./city/types";
import { monotonicServerTime, reconcileGameSnapshot } from "./gameSnapshotReconcile";

const snapshot = (teamRevision: number, gameRevision: number): GameSnapshot =>
  ({
    game: { id: "game", status: "active", serverTime: 1_000 + gameRevision, revision: gameRevision },
    viewer: { userId: "user", teamId: "team", role: "mrf" },
    team: {
      teamId: "team", citySlot: 1, walletCents: teamRevision * 100,
      health: 100, totalCO2Kg: teamRevision, rewardMultiplierBasisPoints: 10_000,
      revision: teamRevision, inventory: {}, roleInventories: {}, wasteSources: [],
      activeJobs: [], transports: [], materialTransfers: [], currentHealthMission: null,
    },
    projects: { preview: [], active: [], queued: [], recentlyClosed: [] },
    teamProjectWork: [], trades: [], chatMessages: [], globalChatMessages: [],
    announcements: [], publicLeaderboard: [],
  }) as unknown as GameSnapshot;

describe("game snapshot reconciliation", () => {
  it("does not let an older team snapshot overwrite newer local team state", () => {
    const current = snapshot(8, 10);
    current.team.walletCents = 8_500;
    const delayed = snapshot(7, 10);
    delayed.team.walletCents = 7_000;

    const reconciled = reconcileGameSnapshot(current, delayed);
    expect(reconciled.team.revision).toBe(8);
    expect(reconciled.team.walletCents).toBe(8_500);
  });

  it("accepts newer public project state while preserving newer private team state", () => {
    const current = snapshot(8, 10);
    const incoming = snapshot(7, 11);
    incoming.projects.active = [
      { _id: "project", sequence: 1, status: "active", template: {} as unknown as ProjectTemplate },
    ];

    const reconciled = reconcileGameSnapshot(current, incoming);
    expect(reconciled.team.revision).toBe(8);
    expect(reconciled.game.revision).toBe(11);
    expect(reconciled.projects.active).toHaveLength(1);
  });

  it("keeps the display clock monotonic until a controlled rebase", () => {
    expect(monotonicServerTime(10_000, 9_000, false)).toBe(10_000);
    expect(monotonicServerTime(10_000, 11_000, false)).toBe(11_000);
    expect(monotonicServerTime(10_000, 9_000, true)).toBe(9_000);
  });
});
