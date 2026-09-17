import type { Inventory, Material } from "@circular-city/contracts";
import type { ProjectTemplate } from "@circular-city/game-content";

export type ProjectMaterialEligibility = {
  material: Material;
  requiredKg: number;
  gradeARequiredKg: number;
  gradeAStoredKg: number;
  gradeBStoredKg: number;
  gradeCStoredKg: number;
  eligibleKg: number;
  unlockedGradeAKg: number;
  hasEnoughMaterial: boolean;
};

export function projectMaterialEligibility(
  template: ProjectTemplate,
  inventory: Inventory,
): ProjectMaterialEligibility[] {
  return (Object.keys(template.requirementsKg) as Material[])
    .filter((material) => template.requirementsKg[material] > 0)
    .map((material) => {
      const stock = inventory[material];
      const requiredKg = template.requirementsKg[material];
      const gradeARequiredKg = template.gradeARequiredKg?.[material] ?? 0;
      const unlockedGradeAKg = Math.max(0, stock.A - (stock.lockedA ?? 0));
      const unlockedGradeBKg = Math.max(0, stock.B - (stock.lockedB ?? 0));
      const eligibleKg = unlockedGradeAKg + unlockedGradeBKg;
      return {
        material,
        requiredKg,
        gradeARequiredKg,
        gradeAStoredKg: stock.A,
        gradeBStoredKg: stock.B,
        gradeCStoredKg: stock.C,
        eligibleKg,
        unlockedGradeAKg,
        hasEnoughMaterial:
          gradeARequiredKg <= requiredKg &&
          unlockedGradeAKg >= gradeARequiredKg &&
          eligibleKg >= requiredKg,
      };
    });
}

export const hasProjectMaterials = (
  rows: ProjectMaterialEligibility[],
): boolean => rows.every((row) => row.hasEnoughMaterial);
