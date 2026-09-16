import { describe, expect, test } from "vitest";
import { STANDARD_SCENARIO } from "@circular-city/game-content";
import {
  dueScheduleSlots,
  dueTimeAnnouncements,
  healthMissionForSlot,
  projectForSequence,
  wasteSpawnIntervalMs,
} from "../src/scheduler.js";

describe("durable scheduler calculations", () => {
  test("keeps the first project in the approved opening set", () => {
    expect(["P01", "P02"]).toContain(projectForSequence(42, 1).id);
  });

  test("does not repeat templates before the deck is exhausted", () => {
    const templates = Array.from({ length: 20 }, (_, index) =>
      projectForSequence(9876, index + 1).id,
    );
    expect(new Set(templates)).toHaveLength(templates.length);
  });

  test("returns every missed timer slot after a worker delay", () => {
    expect(dueScheduleSlots(-1, 61_000, 0, 15_000)).toEqual([0, 1, 2, 3, 4]);
    expect(dueScheduleSlots(-1, 61_000, 50_000, 60_000)).toEqual([0]);
    expect(dueScheduleSlots(0, 171_000, 50_000, 60_000)).toEqual([1, 2]);
  });

  test("selects the requested game-time announcements exactly at each threshold", () => {
    const activeEndsAt = 1_200_000;
    expect(dueTimeAnnouncements(activeEndsAt, 299_999)).toEqual([]);
    expect(dueTimeAnnouncements(activeEndsAt, 300_000)).toEqual([
      { remainingMs: 900_000, message: "15 minutes remaining!" },
    ]);
    expect(dueTimeAnnouncements(activeEndsAt, 900_000)).toEqual([
      { remainingMs: 900_000, message: "15 minutes remaining!" },
      { remainingMs: 600_000, message: "10 minutes remaining!" },
      { remainingMs: 300_000, message: "5 minutes left!" },
    ]);
    expect(dueTimeAnnouncements(activeEndsAt, 1_140_000)).toEqual([
      { remainingMs: 900_000, message: "15 minutes remaining!" },
      { remainingMs: 600_000, message: "10 minutes remaining!" },
      { remainingMs: 300_000, message: "5 minutes left!" },
      { remainingMs: 60_000, message: "Last 1 minute!" },
    ]);
  });

  test("produces deterministic per-city waste intervals within the configured bounds", () => {
    const intervals = Array.from({ length: 12 }, (_, sequence) =>
      wasteSpawnIntervalMs(42, 3, sequence, 10_000, 30_000),
    );
    expect(intervals).toEqual(
      Array.from({ length: 12 }, (_, sequence) =>
        wasteSpawnIntervalMs(42, 3, sequence, 10_000, 30_000),
      ),
    );
    expect(intervals.every((value) => value >= 10_000 && value <= 30_000)).toBe(true);
    expect(wasteSpawnIntervalMs(42, 4, 0, 10_000, 30_000)).not.toBe(intervals[0]);
  });

  test("schedules the first role quiz at 30 seconds and then every minute", () => {
    expect(
      dueScheduleSlots(
        -1,
        29_999,
        STANDARD_SCENARIO.firstHealthMissionMs,
        STANDARD_SCENARIO.healthMissionMs,
      ),
    ).toEqual([]);
    expect(
      dueScheduleSlots(
        -1,
        30_000,
        STANDARD_SCENARIO.firstHealthMissionMs,
        STANDARD_SCENARIO.healthMissionMs,
      ),
    ).toEqual([0]);
    expect(
      dueScheduleSlots(
        0,
        90_000,
        STANDARD_SCENARIO.firstHealthMissionMs,
        STANDARD_SCENARIO.healthMissionMs,
      ),
    ).toEqual([1]);
  });

  test("uses every quiz template before repeating a city's quiz deck", () => {
    const firstDeck = Array.from({ length: 30 }, (_, slot) =>
      healthMissionForSlot(42, 3, slot).id,
    );
    expect(new Set(firstDeck)).toHaveLength(30);
    expect(firstDeck).toEqual(
      Array.from({ length: 30 }, (_, slot) =>
        healthMissionForSlot(42, 3, slot).id,
      ),
    );
  });
});
