import { describe, expect, it } from "vitest";
import type { Inventory } from "@circular-city/contracts";
import type { ProjectTemplate } from "@circular-city/game-content";
import { hasProjectMaterials, projectMaterialEligibility } from "./projectEligibility";

const inventoryFixture = (): Inventory => ({
  paper: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  plastic: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  metal: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  glass: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  wood: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
});

const projectFixture = (): ProjectTemplate => ({
  id: "project-fixture",
  title: "Project fixture",
  tier: 1,
  requirementsKg: { paper: 1_000, plastic: 0, metal: 0, glass: 0, wood: 0 },
  gradeARequiredKg: { paper: 200, plastic: 0, metal: 0, glass: 0, wood: 0 },
  grossRevenueCents: 1,
  co2ImpactKg: 0,
  activeDurationMs: 60_000,
  context: "test",
});

describe("project material eligibility", () => {
  it("excludes Grade C and checks Grade A critical portions separately", () => {
    const template = projectFixture();
    const inventory = inventoryFixture();
    inventory.paper.A = 200;
    inventory.paper.B = 800;
    inventory.paper.C = 1_000;

    const rows = projectMaterialEligibility(template, inventory);
    expect(rows).toEqual([
      expect.objectContaining({
        material: "paper",
        gradeAStoredKg: 200,
        gradeBStoredKg: 800,
        gradeCStoredKg: 1_000,
        eligibleKg: 1_000,
        hasEnoughMaterial: true,
      }),
    ]);
    expect(hasProjectMaterials(rows)).toBe(true);
  });

  it("does not allow locked stock or Grade B stock to satisfy a Grade A portion", () => {
    const template = projectFixture();
    const inventory = inventoryFixture();
    inventory.paper.A = 200;
    inventory.paper.lockedA = 100;
    inventory.paper.B = 900;

    expect(hasProjectMaterials(projectMaterialEligibility(template, inventory))).toBe(
      false,
    );
  });
});
