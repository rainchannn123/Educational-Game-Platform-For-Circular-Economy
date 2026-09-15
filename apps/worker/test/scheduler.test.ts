import { describe, expect, test } from "vitest";
import {
  dueScheduleSlots,
  dueTimeAnnouncements,
  projectForSequence,
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
});
