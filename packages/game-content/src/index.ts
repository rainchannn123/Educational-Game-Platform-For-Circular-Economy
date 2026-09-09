import type { Material, MaterialMap, Role } from "@circular-city/contracts";

export interface MaterialDefinition {
  key: Material;
  externalPriceCentsPerKg: number;
  externalCO2MilliKgPerKg: number;
  baseRecoveryRateBasisPoints: number;
  processCO2KgPerKg: number;
  projectUseCO2KgPerKg: number;
  referenceTradeValueCentsPerKg: number;
}
export interface ProjectTemplate {
  id: string;
  title: string;
  tier: number;
  requirementsKg: MaterialMap;
  grossRevenueCents: number;
  co2ImpactKg: number;
  activeDurationMs: number;
  context: string;
}
export interface HealthOption {
  key: string;
  label: string;
  appropriate: boolean;
  highImpact: boolean;
  costCents?: number;
  co2Kg?: number;
}
export interface HealthMissionTemplate {
  id: string;
  title: string;
  explanation: string;
  options: Record<Role, HealthOption[]>;
}

export const MATERIALS: Record<Material, MaterialDefinition> = {
  paper: {
    key: "paper",
    externalPriceCentsPerKg: 36,
    externalCO2MilliKgPerKg: 400,
    baseRecoveryRateBasisPoints: 8500,
    processCO2KgPerKg: 0.12,
    projectUseCO2KgPerKg: 0.8,
    referenceTradeValueCentsPerKg: 18,
  },
  plastic: {
    key: "plastic",
    externalPriceCentsPerKg: 70,
    externalCO2MilliKgPerKg: 700,
    baseRecoveryRateBasisPoints: 8000,
    processCO2KgPerKg: 0.18,
    projectUseCO2KgPerKg: 2.5,
    referenceTradeValueCentsPerKg: 35,
  },
  metal: {
    key: "metal",
    externalPriceCentsPerKg: 120,
    externalCO2MilliKgPerKg: 900,
    baseRecoveryRateBasisPoints: 9000,
    processCO2KgPerKg: 0.16,
    projectUseCO2KgPerKg: 1.5,
    referenceTradeValueCentsPerKg: 60,
  },
  glass: {
    key: "glass",
    externalPriceCentsPerKg: 24,
    externalCO2MilliKgPerKg: 300,
    baseRecoveryRateBasisPoints: 7500,
    processCO2KgPerKg: 0.12,
    projectUseCO2KgPerKg: 0.6,
    referenceTradeValueCentsPerKg: 12,
  },
  wood: {
    key: "wood",
    externalPriceCentsPerKg: 20,
    externalCO2MilliKgPerKg: 250,
    baseRecoveryRateBasisPoints: 9000,
    processCO2KgPerKg: 0.08,
    projectUseCO2KgPerKg: 0.3,
    referenceTradeValueCentsPerKg: 10,
  },
};
export const EMPTY_MATERIALS: MaterialMap = {
  paper: 0,
  plastic: 0,
  metal: 0,
  glass: 0,
  wood: 0,
};
const project = (
  id: string,
  title: string,
  tier: number,
  r: Partial<MaterialMap>,
  dollars: number,
  co2Tons: number,
  seconds: number,
  context: string,
): ProjectTemplate => ({
  id,
  title,
  tier,
  requirementsKg: { ...EMPTY_MATERIALS, ...r },
  grossRevenueCents: dollars * 100,
  co2ImpactKg: co2Tons * 1000,
  activeDurationMs: seconds * 1000,
  context,
});
export const PROJECTS: ProjectTemplate[] = [
  project(
    "P01",
    "Neighborhood Pocket Park",
    1,
    { wood: 2000, paper: 1000 },
    3200,
    -1.2,
    75,
    "Reuse creates welcoming public space.",
  ),
  project(
    "P02",
    "School Recycling Corner",
    1,
    { paper: 2000, plastic: 1000, metal: 1000 },
    3800,
    -1,
    75,
    "Sorting infrastructure makes recovery visible.",
  ),
  project(
    "P03",
    "Community Repair Kiosk",
    1,
    { wood: 2000, metal: 1000, glass: 1000 },
    4100,
    -1.4,
    75,
    "Repair keeps products and material in use.",
  ),
  project(
    "P04",
    "Eco Bus Stop Shelter",
    2,
    { metal: 3000, paper: 2000, plastic: 1000 },
    5600,
    -1.8,
    75,
    "Recovered metal supports durable mobility infrastructure.",
  ),
  project(
    "P05",
    "Refill Station Network",
    2,
    { plastic: 2000, metal: 2000, glass: 2000 },
    5900,
    -2,
    80,
    "Refill networks prevent single-use packaging.",
  ),
  project(
    "P06",
    "Riverbank Sorting Pier",
    2,
    { wood: 3000, metal: 2000, plastic: 2000 },
    6100,
    -1.5,
    80,
    "Recovery infrastructure protects waterways.",
  ),
  project(
    "P07",
    "Public Library Furniture Renewal",
    2,
    { wood: 3000, paper: 2000, metal: 1000 },
    5400,
    -1.1,
    75,
    "Refurbishment extends material lifetimes.",
  ),
  project(
    "P08",
    "Smart Waste Bin Network",
    3,
    { plastic: 3000, metal: 3000, glass: 2000, paper: 1000 },
    7500,
    -2.2,
    90,
    "Better sorting improves city material loops.",
  ),
  project(
    "P09",
    "Circular Market Pavilion",
    3,
    { wood: 3000, metal: 3000, glass: 2000, paper: 2000 },
    7800,
    -2.5,
    90,
    "A secondary-material market supports reuse.",
  ),
  project(
    "P10",
    "Green Civic Plaza",
    3,
    { glass: 4000, metal: 3000, wood: 2000 },
    7100,
    -1.7,
    85,
    "Logistics and quality shape glass reuse.",
  ),
  project(
    "P11",
    "Low-Carbon Housing Retrofit",
    3,
    { wood: 4000, metal: 3000, plastic: 2000, glass: 1000 },
    8600,
    -2,
    90,
    "Circular construction reduces virgin demand.",
  ),
  project(
    "P12",
    "Materials Innovation Lab",
    4,
    { paper: 4000, plastic: 4000, metal: 3000, glass: 2000, wood: 2000 },
    10200,
    -3,
    100,
    "Material diversity enables innovation.",
  ),
  project(
    "P13",
    "Industrial Reuse Depot",
    4,
    { metal: 5000, wood: 4000, plastic: 3000, glass: 2000 },
    10800,
    -2.8,
    100,
    "Industrial loops retain high-value materials.",
  ),
  project(
    "P14",
    "Resilient Eco-School",
    4,
    { wood: 4000, glass: 3000, paper: 3000, metal: 3000 },
    9600,
    -2.4,
    95,
    "Circular schools pair learning and service.",
  ),
  project(
    "P15",
    "Solar Street Canopy",
    4,
    { metal: 5000, plastic: 4000, wood: 2000 },
    9900,
    0.5,
    95,
    "Construction has a visible carbon trade-off.",
  ),
  project(
    "P16",
    "Urban Reuse Hub",
    5,
    { metal: 5000, paper: 4000, plastic: 4000, wood: 3000, glass: 2000 },
    12500,
    -3.6,
    110,
    "A city reuse hub coordinates many loops.",
  ),
  project(
    "P17",
    "Circular Trade Hall",
    5,
    { glass: 5000, wood: 5000, paper: 4000, plastic: 4000, metal: 5000 },
    14000,
    -4,
    115,
    "Trade can keep recovered material circulating.",
  ),
  project(
    "P18",
    "Citywide Compost Learning Center",
    3,
    { wood: 3000, glass: 3000, paper: 2000, metal: 1000 },
    7200,
    -2.1,
    85,
    "Circular learning includes organic resource loops.",
  ),
  project(
    "P19",
    "Flood-Resilient Recovery Station",
    5,
    { metal: 5000, plastic: 4000, wood: 4000, glass: 3000 },
    13200,
    -3.2,
    110,
    "Resilient recovery infrastructure protects cities.",
  ),
  project(
    "P20",
    "Community Tool Library",
    2,
    { metal: 3000, wood: 2000, plastic: 1000 },
    5200,
    -1.6,
    80,
    "Sharing reduces demand for new products.",
  ),
];
const options = (appropriate: string, highImpact: string): HealthOption[] => [
  {
    key: appropriate,
    label: "Effective circular response",
    appropriate: true,
    highImpact: false,
  },
  {
    key: `high-impact-${highImpact}`,
    label: "High-impact circular response",
    appropriate: true,
    highImpact: true,
  },
  {
    key: `delay-${appropriate}`,
    label: "Delay action until later",
    appropriate: false,
    highImpact: false,
  },
];
export const HEALTH_MISSIONS: HealthMissionTemplate[] = [
  {
    id: "H01",
    title: "Source Separation Campaign",
    explanation:
      "Better source separation reduces contamination and improves recovery.",
    options: {
      municipality: options(
        "target-residential-mixed",
        "target-residential-mixed",
      ),
      mrf: options("sorting-guidance", "sorting-guidance"),
      broker: options("fund-reusable-signage", "fund-reusable-signage"),
    },
  },
  {
    id: "H02",
    title: "Illegal Dumping Response",
    explanation:
      "Documented, low-carbon recovery protects public trust and environmental quality.",
    options: {
      municipality: options("documented-collection", "documented-collection"),
      mrf: options("separate-hazardous", "separate-hazardous"),
      broker: options("low-carbon-contractor", "low-carbon-contractor"),
    },
  },
  {
    id: "H03",
    title: "Repair and Reuse Pop-up",
    explanation:
      "Repair and reuse retain products and materials in service longer.",
    options: {
      municipality: options("accessible-drop-off", "accessible-drop-off"),
      mrf: options("identify-repairable", "identify-repairable"),
      broker: options("fund-repair-partner", "fund-repair-partner"),
    },
  },
  {
    id: "H04",
    title: "Overflowing Collection Zone",
    explanation: "Reliable collection prevents service failures.",
    options: {
      municipality: options("consolidated-route", "consolidated-route"),
      mrf: options("balanced-capacity", "balanced-capacity"),
      broker: options("route-optimization", "route-optimization"),
    },
  },
  {
    id: "H05",
    title: "Recycling Quality Audit",
    explanation: "Quality determines whether material can re-enter use.",
    options: {
      municipality: options("source-feedback", "source-feedback"),
      mrf: options("sample-contamination", "sample-contamination"),
      broker: options("needed-qa-supplies", "needed-qa-supplies"),
    },
  },
  {
    id: "H06",
    title: "Public Procurement Check",
    explanation:
      "Circular procurement requires traceability and appropriate standards.",
    options: {
      municipality: options("recycled-content-plan", "recycled-content-plan"),
      mrf: options("confirm-traceability", "confirm-traceability"),
      broker: options("transparent-source", "transparent-source"),
    },
  },
  {
    id: "H07",
    title: "Reuse Exchange Day",
    explanation: "Sharing and reuse can avoid waste generation.",
    options: {
      municipality: options("exchange-point", "exchange-point"),
      mrf: options("reuse-first", "reuse-first"),
      broker: options("community-partner", "community-partner"),
    },
  },
  {
    id: "H08",
    title: "Construction Waste Prevention",
    explanation: "Prevention and recovery reduce construction waste.",
    options: {
      municipality: options("source-separation", "source-separation"),
      mrf: options("isolate-materials", "isolate-materials"),
      broker: options("reusable-collection", "reusable-collection"),
    },
  },
];

export const STANDARD_SCENARIO = {
  id: "standard-urban-rush-v1",
  minimumTeams: 2,
  maximumTeams: 30,
  teamSize: 3,
  briefingMs: 45_000,
  activeMs: 600_000,
  finalizationMs: 20_000,
  startingWalletCents: 1_200_000,
  startingHealth: 70,
  activeProjectCap: 4,
  projectAnnounceMs: 20_000,
  projectPreviewMs: 10_000,
  finalProjectAnnouncementMs: 540_000,
  stopAnnouncementsMs: 560_000,
  wasteRefreshMs: 15_000,
  wasteVisibleCap: 4,
  wasteExpiryMs: 55_000,
  mrfQueueCap: 3,
  healthMissionMs: 60_000,
  firstHealthMissionMs: 50_000,
  healthDeadlineMs: 50_000,
  tradeExpiryMs: 25_000,
  standardTradeMs: 8_000,
  lowCarbonTradeMs: 15_000,
} as const;
