import type {
  DeliveryMode,
  Grade,
  Inventory,
  Material,
  MaterialMap,
  ProcessingMode,
  Role,
  Route,
} from "@circular-city/contracts";
import {
  EMPTY_MATERIALS,
  MATERIALS,
  STANDARD_SCENARIO,
  type HealthMissionTemplate,
  type ProjectTemplate,
} from "@circular-city/game-content";

export class RuleError extends Error {
  constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
  }
}
export const materialKeys = Object.keys(EMPTY_MATERIALS) as Material[];
export const roundHalfUp = (numerator: number, denominator = 1): number =>
  Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));
export const emptyInventory = (): Inventory => ({
  paper: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  plastic: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  metal: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  glass: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
  wood: { A: 0, B: 0, C: 0, lockedKg: 0, lockedA: 0, lockedB: 0, lockedC: 0 },
});
export const copyInventory = (inventory: Inventory): Inventory =>
  structuredClone(inventory);

export interface TeamMetrics {
  collectedKg: number;
  recoveredKg: number;
  landfilledKg: number;
  tradedKg: number;
  externalPurchasedKg: number;
  projectConsumedKg: number;
  projectsWon: number;
}
export interface TeamState {
  id: string;
  citySlot: number;
  status: "active" | "strained" | "critical" | "emergency" | "withdrawn";
  walletCents: number;
  lockedCashCents: number;
  reservedCashCents: number;
  health: number;
  totalCO2Kg: number;
  revision: number;
  inventory: Inventory;
  provenance: { recoveredKg: number; tradedKg: number; externalKg: number };
  metrics: TeamMetrics;
  lastProjectClaimedAt: number | null;
}
export interface WasteBatch {
  id: string;
  massKg: number;
  compositionKg: MaterialMap;
  contaminationBasisPoints: number;
  status:
    | "available"
    | "in_transit"
    | "at_mrf"
    | "held"
    | "processing"
    | "processed"
    | "landfilled"
    | "expired";
  expiresAt: number;
  queueArrivedAt?: number;
  holdExpiresAt?: number;
}
export interface ProcessResult {
  outputKg: MaterialMap;
  residueKg: number;
  grade: Grade;
  processingCostCents: number;
  processingCO2Kg: number;
  residueCostCents: number;
  residueCO2Kg: number;
  healthDelta: number;
}
export interface Co2Receipt {
  averageCO2Kg: number;
  winnerCO2Kg: number;
  multiplierBasisPoints: number;
  grossRevenueCents: number;
  netRevenueCents: number;
}
export interface Co2Multiplier {
  averageCO2Kg: number;
  winnerCO2Kg: number;
  eligibleTeamCount: number;
  multiplierBasisPoints: number;
}
export interface ProjectWork {
  municipalityReady: boolean;
  mrfReady: boolean;
  brokerReady: boolean;
  plannedMaterialsKg: MaterialMap;
  workRevision: number;
}
export interface TradeMaterial {
  materialType: Material;
  grade: Grade;
  quantityKg: number;
}
export interface TradeRequestMaterial {
  materialType: Material;
  minimumGrade: Grade;
  quantityKg: number;
}
export interface TradeTerms {
  offered: { materials: TradeMaterial[]; cashCents: number };
  requested: { materials: TradeRequestMaterial[]; cashCents: number };
  deliveryMode: DeliveryMode;
}

const gradeRank: Record<Grade, number> = { A: 3, B: 2, C: 1 };
export const healthStatus = (health: number): TeamState["status"] =>
  health >= 35
    ? "active"
    : health >= 20
      ? "strained"
      : health >= 10
        ? "critical"
        : "emergency";
export const healthPenaltyForLandfill = (kg: number): number =>
  kg < 2000 ? -1 : kg < 4000 ? -2 : kg < 6000 ? -3 : -4;
export const availableMaterialKg = (
  inventory: Inventory,
  material: Material,
  minGrade: Grade = "C",
): number =>
  (gradeRank.A >= gradeRank[minGrade]
    ? inventory[material].A - (inventory[material].lockedA ?? 0)
    : 0) +
  (gradeRank.B >= gradeRank[minGrade]
    ? inventory[material].B - (inventory[material].lockedB ?? 0)
    : 0) +
  (gradeRank.C >= gradeRank[minGrade]
    ? inventory[material].C - (inventory[material].lockedC ?? 0)
    : 0);
export const availableEligibleKg = (
  inventory: Inventory,
  material: Material,
): number =>
  inventory[material].A - (inventory[material].lockedA ?? 0) +
  inventory[material].B - (inventory[material].lockedB ?? 0);
export const assertWallet = (wallet: number, cost: number): void => {
  if (wallet - cost < 0) throw new RuleError("INSUFFICIENT_WALLET");
};
export const assertRevision = (team: TeamState, expected: number): void => {
  if (team.revision !== expected) throw new RuleError("STALE_TEAM_REVISION");
};
export const addMaterial = (
  inventory: Inventory,
  material: Material,
  grade: Grade,
  quantityKg: number,
): void => {
  inventory[material][grade] += quantityKg;
};

export const sameMaterialMap = (a: MaterialMap, b: MaterialMap): boolean =>
  materialKeys.every((material) => a[material] === b[material]);

export function calculateCo2Receipt(
  winner: TeamState,
  teams: TeamState[],
  grossRevenueCents: number,
): Co2Receipt {
  const multiplier = calculateCo2Multiplier(winner, teams);
  return {
    averageCO2Kg: multiplier.averageCO2Kg,
    winnerCO2Kg: multiplier.winnerCO2Kg,
    multiplierBasisPoints: multiplier.multiplierBasisPoints,
    grossRevenueCents,
    netRevenueCents: roundHalfUp(
      grossRevenueCents * multiplier.multiplierBasisPoints,
      10_000,
    ),
  };
}

export function calculateCo2Multiplier(
  winner: Pick<TeamState, "status" | "totalCO2Kg">,
  teams: Array<Pick<TeamState, "status" | "totalCO2Kg">>,
): Co2Multiplier {
  const eligible = teams.filter((team) => team.status !== "withdrawn");
  const eligibleTeamCount = Math.max(eligible.length, 1);
  const averageCO2Kg = Math.floor(
    eligible.reduce((sum, team) => sum + Math.max(0, team.totalCO2Kg), 0) /
      eligibleTeamCount,
  );
  const winnerCO2Kg = Math.max(0, winner.totalCO2Kg);

  let multiplierBasisPoints = 10_000;
  if (winnerCO2Kg <= 0) {
    multiplierBasisPoints = averageCO2Kg > 0 ? 20_000 : 10_000;
  } else {
    multiplierBasisPoints = clamp(
      roundHalfUp(averageCO2Kg * 10_000, winnerCO2Kg),
      5_000,
      20_000,
    );
  }

  return {
    averageCO2Kg,
    winnerCO2Kg,
    eligibleTeamCount,
    multiplierBasisPoints,
  };
}

export function calculateCollection(
  batch: WasteBatch,
  route: Route,
): { durationMs: number; costCents: number; co2Kg: number } {
  const config: Record<
    Route,
    {
      durationMs: number;
      costCentsNumerator: number;
      costCentsDenominator: number;
      co2MilliKgPerKg: number;
    }
  > = {
    express: {
      durationMs: 6000,
      costCentsNumerator: 7,
      costCentsDenominator: 1,
      co2MilliKgPerKg: 360,
    },
    standard: {
      durationMs: 10000,
      costCentsNumerator: 45,
      costCentsDenominator: 10,
      co2MilliKgPerKg: 180,
    },
    consolidated: {
      durationMs: 16000,
      costCentsNumerator: 28,
      costCentsDenominator: 10,
      co2MilliKgPerKg: 100,
    },
  };
  const selected = config[route];
  return {
    durationMs: selected.durationMs,
    costCents: roundHalfUp(
      batch.massKg * selected.costCentsNumerator,
      selected.costCentsDenominator,
    ),
    co2Kg: roundHalfUp(batch.massKg * selected.co2MilliKgPerKg, 1000),
  };
}

export function calculateProcessing(
  batch: WasteBatch,
  mode: Exclude<ProcessingMode, "hold">,
): ProcessResult {
  if (mode === "landfill")
    return {
      outputKg: { ...EMPTY_MATERIALS },
      residueKg: batch.massKg,
      grade: "C",
      processingCostCents: roundHalfUp(batch.massKg * 5, 1),
      processingCO2Kg: roundHalfUp(batch.massKg * 2500, 1000),
      residueCostCents: 0,
      residueCO2Kg: 0,
      healthDelta: healthPenaltyForLandfill(batch.massKg),
    };
  const config: Record<
    Exclude<ProcessingMode, "hold" | "landfill">,
    {
      costCentsNumerator: number;
      costCentsDenominator: number;
      co2MilliKgPerKg: number;
      yieldBps: number;
      grade: Grade;
    }
  > = {
    rapid: {
      costCentsNumerator: 65,
      costCentsDenominator: 10,
      co2MilliKgPerKg: 180,
      yieldBps: 8500,
      grade: batch.contaminationBasisPoints <= 1000 ? "B" : "C",
    },
    balanced: {
      costCentsNumerator: 5,
      costCentsDenominator: 1,
      co2MilliKgPerKg: 120,
      yieldBps: 10000,
      grade: batch.contaminationBasisPoints <= 1500 ? "B" : "C",
    },
    quality: {
      costCentsNumerator: 7,
      costCentsDenominator: 1,
      co2MilliKgPerKg: 100,
      yieldBps: 10700,
      grade: batch.contaminationBasisPoints <= 1200 ? "A" : "B",
    },
  };
  const selected = config[mode];
  const output = { ...EMPTY_MATERIALS };
  for (const material of materialKeys)
    output[material] = Math.floor(
      (batch.compositionKg[material] *
        MATERIALS[material].baseRecoveryRateBasisPoints *
        selected.yieldBps *
        Math.max(5000, 10000 - batch.contaminationBasisPoints)) /
        1_000_000_000_000,
    );
  const recoveredKg = materialKeys.reduce(
    (sum, material) => sum + output[material],
    0,
  );
  const residueKg = batch.massKg - recoveredKg;
  return {
    outputKg: output,
    residueKg,
    grade: selected.grade,
    processingCostCents: roundHalfUp(
      batch.massKg * selected.costCentsNumerator,
      selected.costCentsDenominator,
    ),
    processingCO2Kg: roundHalfUp(batch.massKg * selected.co2MilliKgPerKg, 1000),
    residueCostCents: roundHalfUp(residueKg * 5),
    residueCO2Kg: roundHalfUp(residueKg * 2500, 1000),
    healthDelta: healthPenaltyForLandfill(residueKg),
  };
}

export function createExternalPurchase(
  team: TeamState,
  material: Material,
  quantityKg: number,
  expectedRevision: number,
): TeamState {
  assertRevision(team, expectedRevision);
  if (quantityKg < 100 || quantityKg > 10_000 || quantityKg % 100 !== 0)
    throw new RuleError("INVALID_QUANTITY");
  const definition = MATERIALS[material];
  const cost = quantityKg * definition.externalPriceCentsPerKg;
  assertWallet(team.walletCents, cost);
  const next = structuredClone(team);
  next.walletCents -= cost;
  next.totalCO2Kg += roundHalfUp(
    quantityKg * definition.externalCO2MilliKgPerKg,
    1000,
  );
  addMaterial(next.inventory, material, "B", quantityKg);
  next.provenance.externalKg += quantityKg;
  next.metrics.externalPurchasedKg += quantityKg;
  next.revision += 1;
  return next;
}

export function consumeProjectMaterials(
  inventory: Inventory,
  required: MaterialMap,
): Inventory {
  const next = copyInventory(inventory);
  for (const material of materialKeys)
    if (availableEligibleKg(next, material) < required[material])
      throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
  for (const material of materialKeys) {
    let remaining = required[material];
    const fromB = Math.min(
      Math.max(0, next[material].B - (next[material].lockedB ?? 0)),
      remaining,
    );
    next[material].B -= fromB;
    remaining -= fromB;
    if (remaining > 0) {
      const availableA = Math.max(
        0,
        next[material].A - (next[material].lockedA ?? 0),
      );
      if (availableA < remaining)
        throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
      next[material].A -= remaining;
    }
  }
  return next;
}

export function assertClaimEligible(
  team: TeamState,
  project: ProjectTemplate,
  now: number,
  expiresAt: number,
): void {
  if (team.status === "withdrawn") throw new RuleError("TEAM_WITHDRAWN");
  if (team.health < 20) throw new RuleError("HEALTH_TOO_LOW_TO_CLAIM");
  if (now > expiresAt) throw new RuleError("PROJECT_NOT_ACTIVE");
  consumeProjectMaterials(team.inventory, project.requirementsKg);
}

export function applyProjectClaim(
  team: TeamState,
  teams: TeamState[],
  project: ProjectTemplate,
  now: number,
  expiresAt: number,
  expectedRevision: number,
): { team: TeamState; receipt: Co2Receipt } {
  assertRevision(team, expectedRevision);
  assertClaimEligible(team, project, now, expiresAt);
  const receipt = calculateCo2Receipt(team, teams, project.grossRevenueCents);
  const next = structuredClone(team);
  next.inventory = consumeProjectMaterials(
    next.inventory,
    project.requirementsKg,
  );
  next.walletCents += receipt.netRevenueCents;
  next.totalCO2Kg = Math.max(0, next.totalCO2Kg + project.co2ImpactKg);
  next.metrics.projectConsumedKg += materialKeys.reduce(
    (sum, material) => sum + project.requirementsKg[material],
    0,
  );
  next.metrics.projectsWon += 1;
  next.lastProjectClaimedAt = now;
  next.revision += 1;
  return { team: next, receipt };
}

export function validateTradeTerms(terms: TradeTerms): {
  offeredValueCents: number;
  requestedValueCents: number;
} {
  const duplicate = <T extends { materialType: Material; grade?: Grade; minimumGrade?: Grade }>(
    lines: T[],
  ): boolean => {
    const seen = new Set<string>();
    return lines.some((line) => {
      const key = `${line.materialType}:${line.grade ?? line.minimumGrade}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  };
  if (
    duplicate(terms.offered.materials) ||
    duplicate(terms.requested.materials)
  )
    throw new RuleError("TRADE_DUPLICATE_MATERIAL_LINE");
  const valueOf = (
    materials: { materialType: Material; quantityKg: number }[],
    cash: number,
  ) =>
    materials.reduce(
      (sum, line) =>
        sum +
        line.quantityKg *
          MATERIALS[line.materialType].referenceTradeValueCentsPerKg,
      cash,
    );
  const offeredValueCents = valueOf(
    terms.offered.materials,
    terms.offered.cashCents,
  );
  const requestedValueCents = valueOf(
    terms.requested.materials,
    terms.requested.cashCents,
  );
  if (offeredValueCents <= 0 || requestedValueCents <= 0)
    throw new RuleError("TRADE_INVALID_ZERO_REQUEST_VALUE");
  if (
    offeredValueCents * 100 < requestedValueCents * 60 ||
    offeredValueCents * 100 > requestedValueCents * 180
  )
    throw new RuleError("TRADE_VALUE_OUT_OF_RANGE");
  return { offeredValueCents, requestedValueCents };
}
export function assertTradeLockable(team: TeamState, terms: TradeTerms): void {
  assertWallet(
    team.walletCents - team.lockedCashCents - team.reservedCashCents,
    terms.offered.cashCents,
  );
  for (const line of terms.offered.materials)
    if (
      team.inventory[line.materialType][line.grade] < line.quantityKg
    )
      throw new RuleError("MATERIAL_LOCKED_FOR_TRADE");
}
export function healthMissionDelta(
  template: HealthMissionTemplate,
  answers: Record<Role, string>,
): { delta: number; appropriateCount: number; highImpact: boolean } {
  const selected = (Object.keys(template.options) as Role[]).map((role) =>
    template.options[role].find((option) => option.key === answers[role]),
  );
  const appropriateCount = selected.filter(
    (option) => option?.appropriate,
  ).length;
  const wrongCount = selected.length - appropriateCount;
  const highImpact = selected.every(
    (option) => option?.appropriate && option?.highImpact,
  );
  return {
    delta: appropriateCount * 3 - wrongCount * 2 + (highImpact ? 1 : 0),
    appropriateCount,
    highImpact,
  };
}
export function calculateRankings(teams: TeamState[]): TeamState[] {
  return [...teams]
    .filter((team) => team.status !== "withdrawn")
    .sort(
      (a, b) =>
        b.walletCents - a.walletCents ||
        a.totalCO2Kg - b.totalCO2Kg ||
        b.health - a.health ||
        (a.lastProjectClaimedAt ?? Number.MAX_SAFE_INTEGER) -
          (b.lastProjectClaimedAt ?? Number.MAX_SAFE_INTEGER) ||
        a.citySlot - b.citySlot,
    );
}
export const defaultTeam = (id: string, citySlot: number): TeamState => ({
  id,
  citySlot,
  status: "active",
  walletCents: STANDARD_SCENARIO.startingWalletCents,
  lockedCashCents: 0,
  reservedCashCents: 0,
  health: STANDARD_SCENARIO.startingHealth,
  totalCO2Kg: 0,
  revision: 0,
  inventory: emptyInventory(),
  provenance: { recoveredKg: 0, tradedKg: 0, externalKg: 0 },
  metrics: {
    collectedKg: 0,
    recoveredKg: 0,
    landfilledKg: 0,
    tradedKg: 0,
    externalPurchasedKg: 0,
    projectConsumedKg: 0,
    projectsWon: 0,
  },
  lastProjectClaimedAt: null,
});
