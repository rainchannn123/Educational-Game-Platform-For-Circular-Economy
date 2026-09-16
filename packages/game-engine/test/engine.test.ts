import { describe, expect, it } from "vitest";
import { HEALTH_MISSIONS, PROJECTS } from "@circular-city/game-content";
import {
  applyProjectClaim,
  applyTeamHealthDelta,
  assertTradeLockable,
  calculateCo2Receipt,
  calculateCollection,
  calculateProcessing,
  consumeProjectMaterials,
  defaultTeam,
  emptyInventory,
  HEALTH_RECOVERY_HEALTH,
  HEALTH_RECOVERY_LOCKOUT_MS,
  healthMissionDelta,
  isTeamHealthRecoveryActive,
  validateTradeTerms,
} from "../src/index.js";

describe("deterministic game rules", () => {
  it("starts and preserves a 30-second recovery lockout at zero health", () => {
    const team = defaultTeam("a", 1);
    team.health = 3;
    const at = 100_000;
    const locked = applyTeamHealthDelta(team, -4, at);
    expect(locked).toEqual({
      health: 0,
      status: "emergency",
      healthRecoveryUntil: at + HEALTH_RECOVERY_LOCKOUT_MS,
    });
    expect(isTeamHealthRecoveryActive(locked, at + 1)).toBe(true);
    expect(applyTeamHealthDelta(locked, -2, at + 5_000)).toEqual(locked);
    expect(HEALTH_RECOVERY_HEALTH).toBe(20);
  });
  it("applies the 0.50x CO2 multiplier at twice room average", () => {
    const winner = defaultTeam("a", 1);
    winner.totalCO2Kg = 2000;
    const other = defaultTeam("b", 2);
    other.totalCO2Kg = 0;
    const receipt = calculateCo2Receipt(winner, [winner, other], 100_000);
    expect(receipt.multiplierBasisPoints).toBe(5000);
    expect(receipt.netRevenueCents).toBe(50_000);
  });
  it("awards the 2.00x cap to strong low-CO2 performance", () => {
    const winner = defaultTeam("a", 1);
    winner.totalCO2Kg = 1000;
    const other = defaultTeam("b", 2);
    other.totalCO2Kg = 3000;
    const receipt = calculateCo2Receipt(winner, [winner, other], 100_000);
    expect(receipt.multiplierBasisPoints).toBe(20_000);
    expect(receipt.netRevenueCents).toBe(200_000);
  });
  it("keeps 1.00x when winner matches room average", () => {
    const winner = defaultTeam("a", 1);
    winner.totalCO2Kg = 2000;
    const other = defaultTeam("b", 2);
    other.totalCO2Kg = 2000;
    const receipt = calculateCo2Receipt(winner, [winner, other], 100_000);
    expect(receipt.multiplierBasisPoints).toBe(10_000);
    expect(receipt.netRevenueCents).toBe(100_000);
  });
  it("recovers paper through hydropulping with contamination-adjusted yield", () => {
    const result = calculateProcessing(
      {
        id: "waste_1",
        massKg: 1000,
        compositionKg: { paper: 1000, plastic: 0, metal: 0, glass: 0, wood: 0 },
        contaminationBasisPoints: 500,
        status: "at_mrf",
        expiresAt: 0,
      },
      "paper-hydropulp-deink",
    );
    expect(result.outputKg.paper).toBe(807);
    expect(result.grade).toBe("A");
    expect(result.residueKg).toBe(193);
    expect(result.processingCostCents).toBe(8_000);
    expect(result.processingCO2Kg).toBe(120);
  });
  it("uses disposal without creating material and applies its health cost", () => {
    const result = calculateProcessing(
      {
        id: "waste_2",
        massKg: 2_000,
        compositionKg: { paper: 0, plastic: 2_000, metal: 0, glass: 0, wood: 0 },
        contaminationBasisPoints: 0,
        status: "at_mrf",
        expiresAt: 0,
      },
      "landfill",
    );
    expect(result.outputKg).toEqual({
      paper: 0,
      plastic: 0,
      metal: 0,
      glass: 0,
      wood: 0,
    });
    expect(result.grade).toBeNull();
    expect(result.healthDelta).toBe(-2);
  });
  it("claims from shared stock distributed across role inventories", () => {
    const team = defaultTeam("a", 1);
    const project = PROJECTS[0]!;
    team.inventory.wood.B = 2000;
    team.inventory.paper.B = 1000;
    team.roleInventories.mrf.wood.B = 2000;
    team.roleInventories.broker.paper.B = 1000;
    const result = applyProjectClaim(
      team,
      [team, defaultTeam("b", 2)],
      project,
      10,
      20,
      0,
    );
    expect(result.team.inventory).toEqual(emptyInventory());
    expect(result.team.roleInventories).toEqual({
      municipality: emptyInventory(),
      mrf: emptyInventory(),
      broker: emptyInventory(),
    });
    expect(result.team.walletCents).toBeGreaterThan(team.walletCents);
  });
  it("never creates material when project inventory is partially locked", () => {
    const inventory = emptyInventory();
    inventory.paper.A = 1_000;
    inventory.paper.B = 500;
    inventory.paper.lockedKg = 500;
    inventory.paper.lockedB = 500;

    expect(() =>
      consumeProjectMaterials(inventory, {
        paper: 1_500,
        plastic: 0,
        metal: 0,
        glass: 0,
        wood: 0,
      }),
    ).toThrow("PROJECT_REQUIREMENTS_NOT_MET");
    expect(inventory.paper.B).toBe(500);
  });
  it("rounds fractional-cent collection costs half up", () => {
    expect(
      calculateCollection(
        {
          id: "waste_1",
          massKg: 1,
          compositionKg: { paper: 1, plastic: 0, metal: 0, glass: 0, wood: 0 },
          contaminationBasisPoints: 0,
          status: "available",
          expiresAt: 0,
        },
        "standard",
      ).costCents,
    ).toBe(5);
  });
  it("rejects trades outside fair-value guardrails", () =>
    expect(() =>
      validateTradeTerms({
        offered: {
          materials: [{ materialType: "wood", grade: "B", quantityKg: 100 }],
          cashCents: 0,
        },
        requested: {
          materials: [
            { materialType: "metal", minimumGrade: "B", quantityKg: 10000 },
          ],
          cashCents: 0,
        },
        deliveryMode: "standard",
      }),
    ).toThrow("TRADE_VALUE_OUT_OF_RANGE"));
  it("rejects duplicate trade lines and cash already locked by another offer", () => {
    expect(() =>
      validateTradeTerms({
        offered: {
          materials: [
            { materialType: "wood", grade: "B", quantityKg: 100 },
            { materialType: "wood", grade: "B", quantityKg: 100 },
          ],
          cashCents: 0,
        },
        requested: {
          materials: [{ materialType: "metal", minimumGrade: "B", quantityKg: 100 }],
          cashCents: 0,
        },
        deliveryMode: "standard",
      }),
    ).toThrow("TRADE_DUPLICATE_MATERIAL_LINE");

    const team = defaultTeam("a", 1);
    team.walletCents = 100;
    team.lockedCashCents = 80;
    expect(() =>
      assertTradeLockable(team, {
        offered: { materials: [], cashCents: 30 },
        requested: { materials: [], cashCents: 30 },
        deliveryMode: "standard",
      }),
    ).toThrow("INSUFFICIENT_WALLET");
  });
  it("awards correct all-high-impact care steps plus ten health", () => {
    const mission = HEALTH_MISSIONS[0]!;
    const answers = {
      municipality: mission.options.municipality.find((option) => option.highImpact)!.key,
      mrf: mission.options.mrf.find((option) => option.highImpact)!.key,
      broker: mission.options.broker.find((option) => option.highImpact)!.key,
    };
    expect(healthMissionDelta(mission, answers).delta).toBe(10);
  });
});
