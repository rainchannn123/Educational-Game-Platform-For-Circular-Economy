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
  questions: Record<Role, string>;
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
export const HEALTH_MISSIONS: HealthMissionTemplate[] = [
  {
    id: "H01",
    title: "Urgent Collection Triage",
    explanation: "Fast role decisions prevent loss and protect recovery quality.",
    questions: {
      municipality:
        "A mixed batch will expire in 20s. What should Municipality do first?",
      mrf: "A medium-contamination batch just arrived. Which processing mode is best by default?",
      broker: "Team is short 2t metal for an active listing. What is the best broker move?",
    },
    options: {
      municipality: [
        {
          key: "dispatch-now-standard",
          label: "Dispatch standard route now",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "wait-next-wave",
          label: "Wait for next wave",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "ignore-expiry",
          label: "Ignore until expired",
          appropriate: false,
          highImpact: false,
        },
      ],
      mrf: [
        {
          key: "balanced-first-pass",
          label: "Run balanced mode",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "landfill-direct",
          label: "Landfill immediately",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "hold-forever",
          label: "Hold without review",
          appropriate: false,
          highImpact: false,
        },
      ],
      broker: [
        {
          key: "accept-fair-metal-trade",
          label: "Secure fair metal trade",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "buy-random-material",
          label: "Buy unrelated material",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "do-nothing-shortage",
          label: "Do nothing",
          appropriate: false,
          highImpact: false,
        },
      ],
    },
  },
  {
    id: "H02",
    title: "Contamination Spike",
    explanation: "Quality control decisions determine downstream claim success.",
    questions: {
      municipality:
        "Community bins show contamination spike. Which municipal action is best?",
      mrf: "Incoming batch has high contamination. Which MRF choice preserves recoverable value?",
      broker: "Buyers ask for proof of grade quality. What should Broker do?",
    },
    options: {
      municipality: [
        {
          key: "issue-targeted-guidance",
          label: "Issue targeted sorting guidance",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "hide-data",
          label: "Hide contamination data",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "pause-all-pickups",
          label: "Pause all pickups",
          appropriate: false,
          highImpact: false,
        },
      ],
      mrf: [
        {
          key: "quality-mode-then-grade",
          label: "Use quality mode then grade",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "rapid-no-check",
          label: "Rapid mode no checks",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "mix-with-clean-stock",
          label: "Mix with clean stock",
          appropriate: false,
          highImpact: false,
        },
      ],
      broker: [
        {
          key: "share-grade-certificates",
          label: "Share grade certificates",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "promise-no-proof",
          label: "Promise without proof",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "discount-everything",
          label: "Discount all offers",
          appropriate: false,
          highImpact: false,
        },
      ],
    },
  },
  {
    id: "H03",
    title: "Route Emissions Choice",
    explanation: "Low-carbon logistics improve long-term score multipliers.",
    questions: {
      municipality:
        "Two routes can deliver in time. Which route strategy is most circular?",
      mrf: "Queue is stable and deadline allows it. Which processing option should MRF prefer?",
      broker: "You can source materials via local trade or costly external wholesale. Best first choice?",
    },
    options: {
      municipality: [
        {
          key: "choose-lower-co2-route",
          label: "Use lower CO2 route",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "always-express",
          label: "Always choose express",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "skip-dispatch",
          label: "Skip dispatch",
          appropriate: false,
          highImpact: false,
        },
      ],
      mrf: [
        {
          key: "balanced-or-quality-fit",
          label: "Balanced or quality mode",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "landfill-to-save-time",
          label: "Landfill to save time",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "hold-all-batches",
          label: "Hold every batch",
          appropriate: false,
          highImpact: false,
        },
      ],
      broker: [
        {
          key: "prioritize-local-trade",
          label: "Prioritize local trade",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "external-only",
          label: "Use external only",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "delay-all-buying",
          label: "Delay all buying",
          appropriate: false,
          highImpact: false,
        },
      ],
    },
  },
  {
    id: "H04",
    title: "Inventory Bottleneck",
    explanation: "Coordinated handoffs avoid queue lock and missed listings.",
    questions: {
      municipality: "MRF queue is filling up. What should Municipality do next?",
      mrf: "Queue is near cap with one urgent batch. What is the best MRF prioritization?",
      broker: "Inventory has surplus glass but metal shortage. Best broker action?",
    },
    options: {
      municipality: [
        {
          key: "stagger-dispatch-based-on-queue",
          label: "Stagger dispatch by queue",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "dump-all-at-once",
          label: "Dispatch all at once",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "pause-collections-long",
          label: "Pause collections entirely",
          appropriate: false,
          highImpact: false,
        },
      ],
      mrf: [
        {
          key: "process-urgent-then-balanced",
          label: "Process urgent then balanced",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "first-in-no-exceptions",
          label: "Strict first-in order",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "landfill-oldest-batch",
          label: "Landfill oldest batch",
          appropriate: false,
          highImpact: false,
        },
      ],
      broker: [
        {
          key: "trade-surplus-for-shortage",
          label: "Trade surplus for metal",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "hoard-surplus",
          label: "Hoard surplus stock",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "sell-surplus-for-cash-only",
          label: "Sell surplus cash-only",
          appropriate: false,
          highImpact: false,
        },
      ],
    },
  },
  {
    id: "H05",
    title: "Public Quality Audit",
    explanation: "Traceability and grading discipline protect project success.",
    questions: {
      municipality: "Auditor asks for source records. Best municipal response?",
      mrf: "Auditor checks grading consistency. Best MRF response?",
      broker: "Buyer asks origin and quality proof. Best broker response?",
    },
    options: {
      municipality: [
        {
          key: "share-documented-source-logs",
          label: "Share source logs",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "estimate-from-memory",
          label: "Estimate from memory",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "refuse-audit",
          label: "Refuse the audit",
          appropriate: false,
          highImpact: false,
        },
      ],
      mrf: [
        {
          key: "show-sampling-records",
          label: "Show sampling records",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "skip-grading-details",
          label: "Skip grading details",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "relabel-without-check",
          label: "Relabel without checks",
          appropriate: false,
          highImpact: false,
        },
      ],
      broker: [
        {
          key: "provide-traceability-pack",
          label: "Provide traceability pack",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "promise-later-docs",
          label: "Promise docs later",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "drop-grade-requirement",
          label: "Drop grade requirement",
          appropriate: false,
          highImpact: false,
        },
      ],
    },
  },
  {
    id: "H06",
    title: "Procurement Pressure",
    explanation: "Under time pressure, choose options that preserve circular value.",
    questions: {
      municipality: "A supplier offers fast virgin materials. Best municipal choice?",
      mrf: "You can output higher quantity low-grade or lower quantity high-grade. Best for active projects?",
      broker: "A trade partner proposes unfair terms far outside value range. Best response?",
    },
    options: {
      municipality: [
        {
          key: "prioritize-recovered-stock",
          label: "Prioritize recovered stock",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "buy-virgin-by-default",
          label: "Buy virgin by default",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "cancel-project-pipeline",
          label: "Cancel project pipeline",
          appropriate: false,
          highImpact: false,
        },
      ],
      mrf: [
        {
          key: "target-usable-grade-a-b",
          label: "Target usable grade A/B",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "maximize-quantity-grade-c",
          label: "Max quantity grade C",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "skip-grading-entirely",
          label: "Skip grading entirely",
          appropriate: false,
          highImpact: false,
        },
      ],
      broker: [
        {
          key: "reject-unfair-and-requote",
          label: "Reject and re-quote fair",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "accept-any-terms",
          label: "Accept any terms",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "ghost-trade-partner",
          label: "Ignore all partners",
          appropriate: false,
          highImpact: false,
        },
      ],
    },
  },
  {
    id: "H07",
    title: "Cross-Team Coordination",
    explanation: "Well-timed communication and transfers maximize city performance.",
    questions: {
      municipality: "MRF asks for cleaner inflow. What should Municipality do now?",
      mrf: "Broker reports urgent shortage for a live listing. Best MRF action?",
      broker: "Municipality and MRF are ready but one material is missing. Best Broker action?",
    },
    options: {
      municipality: [
        {
          key: "prioritize-cleanest-batches",
          label: "Prioritize cleaner batches",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "send-random-order",
          label: "Send random order",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "withhold-all-batches",
          label: "Withhold all batches",
          appropriate: false,
          highImpact: false,
        },
      ],
      mrf: [
        {
          key: "prioritize-needed-material-recovery",
          label: "Prioritize needed materials",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "process-least-useful-first",
          label: "Process least useful first",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "pause-until-next-cycle",
          label: "Pause until next cycle",
          appropriate: false,
          highImpact: false,
        },
      ],
      broker: [
        {
          key: "close-gap-with-best-source",
          label: "Close gap with best source",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "wait-for-market-later",
          label: "Wait for later market",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "buy-unneeded-cheap-lot",
          label: "Buy cheap unneeded lot",
          appropriate: false,
          highImpact: false,
        },
      ],
    },
  },
  {
    id: "H08",
    title: "Final Minute Strategy",
    explanation: "Near listing deadline, strategic circular choices matter most.",
    questions: {
      municipality: "Only one dispatch remains before expiry. Best municipal priority?",
      mrf: "One batch can be processed before listing expiry. Best MRF choice?",
      broker: "Only 15s remain and team needs 1t paper. Best broker action?",
    },
    options: {
      municipality: [
        {
          key: "dispatch-batch-that-fills-gap",
          label: "Dispatch gap-filling batch",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "dispatch-largest-random",
          label: "Dispatch largest random",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "skip-last-dispatch",
          label: "Skip final dispatch",
          appropriate: false,
          highImpact: false,
        },
      ],
      mrf: [
        {
          key: "process-high-likelihood-success",
          label: "Process highest success batch",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "process-highest-contamination",
          label: "Process dirtiest batch",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "hold-instead-of-process",
          label: "Hold instead of process",
          appropriate: false,
          highImpact: false,
        },
      ],
      broker: [
        {
          key: "use-fastest-valid-source",
          label: "Use fastest valid source",
          appropriate: true,
          highImpact: true,
        },
        {
          key: "negotiate-long-contract",
          label: "Negotiate long contract",
          appropriate: false,
          highImpact: false,
        },
        {
          key: "do-nothing-last-seconds",
          label: "Do nothing",
          appropriate: false,
          highImpact: false,
        },
      ],
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
  healthMissionMs: 20_000,
  firstHealthMissionMs: 0,
  healthDeadlineMs: 20_000,
  tradeExpiryMs: 25_000,
  standardTradeMs: 8_000,
  lowCarbonTradeMs: 15_000,
} as const;
