import { describe, expect, it } from "vitest";
import {
  HEALTH_MISSIONS,
  ROLE_QUIZ_QUESTIONS,
  STANDARD_SCENARIO,
} from "../src/index.js";

describe("role quiz content", () => {
  it("provides all 30 supplied questions for every role", () => {
    expect(ROLE_QUIZ_QUESTIONS.municipality).toHaveLength(30);
    expect(ROLE_QUIZ_QUESTIONS.mrf).toHaveLength(30);
    expect(ROLE_QUIZ_QUESTIONS.broker).toHaveLength(30);
    expect(HEALTH_MISSIONS).toHaveLength(30);
  });

  it("builds four answer choices with exactly one correct answer per role", () => {
    for (const mission of HEALTH_MISSIONS) {
      for (const role of ["municipality", "mrf", "broker"] as const) {
        expect(mission.questions[role]).not.toHaveLength(0);
        expect(mission.options[role]).toHaveLength(4);
        expect(
          mission.options[role].filter((option) => option.appropriate),
        ).toHaveLength(1);
      }
    }
  });

  it("starts after 30 seconds and gives players 30 seconds to answer", () => {
    expect(STANDARD_SCENARIO.firstHealthMissionMs).toBe(30_000);
    expect(STANDARD_SCENARIO.healthMissionMs).toBe(60_000);
    expect(STANDARD_SCENARIO.healthDeadlineMs).toBe(30_000);
  });
});
