import type { Inventory, Material, Role } from "@circular-city/contracts";
import type { ProjectTemplate } from "@circular-city/game-content";

export type CityFacility =
  | "municipality"
  | "mrf"
  | "broker"
  | "warehouse"
  | "future-site";

export type CitySourceStatus =
  "available" | "in_transit" | "at_mrf" | "held" | "processing";

export interface GameSnapshot {
  game: {
    id: string;
    status: string;
    serverTime: number;
    activeEndsAt?: number;
    finalizationEndsAt?: number;
    revision: number;
  };
  viewer: {
    userId: string;
    teamId: string;
    role: Role;
  };
  team: {
    teamId: string;
    citySlot: number;
    walletCents: number;
    health: number;
    totalCO2Kg: number;
    rewardMultiplierBasisPoints: number;
    revision: number;
    inventory: Inventory;
    wasteSources: WasteSource[];
    activeJobs: ProcessJob[];
    transports: Transport[];
    currentHealthMission: HealthMission | null;
    mrfActionGuide?: Record<string, MrfActionGuide[]>;
  };
  projects: {
    preview: GameProject[];
    active: GameProject[];
    queued: GameProject[];
    recentlyClosed: GameProject[];
  };
  teamProjectWork: ProjectWork[];
  trades: TradeOffer[];
  chatMessages: ChatMessage[];
  publicLeaderboard: PublicLeaderboardEntry[];
}

export interface WasteSource {
  _id: string;
  massKg: number;
  compositionKg: Record<Material, number>;
  contaminationBasisPoints: number;
  status: CitySourceStatus;
  expiresAt: number;
  transitArrivesAt?: number;
  queueArrivedAt?: number;
  holdExpiresAt?: number;
}

export interface ProcessJob {
  _id: string;
  wasteSourceId: string;
  mode: "rapid" | "balanced" | "quality" | "hold" | "landfill";
  dueAt: number;
  status: "processing";
}

export interface Transport {
  _id: string;
  wasteSourceId: string;
  route: "express" | "standard" | "consolidated";
  arrivesAt: number;
  status: "in_transit";
}

export interface HealthMission {
  _id: string;
  templateId: string;
  status: "active";
  expiresAt: number;
  steps: Partial<Record<Role, { optionKey: string }>>;
}

export interface TradeMaterialLine {
  materialType: Material;
  grade?: "A" | "B" | "C";
  minimumGrade?: "A" | "B" | "C";
  quantityKg: number;
}

export interface TradeOffer {
  _id: string;
  offeringTeamId: string;
  recipientTeamId: string;
  status: string;
  expiresAt?: number;
  deliveryDueAt?: number;
  terms: {
    offered: { materials: TradeMaterialLine[]; cashCents: number };
    requested: { materials: TradeMaterialLine[]; cashCents: number };
    deliveryMode: "standard" | "low-carbon";
  };
}

export interface GameProject {
  _id: string;
  sequence: number;
  status:
    "announced" | "active" | "queued" | "claimed" | "expired" | "cancelled";
  template: ProjectTemplate;
  previewAt?: number;
  announcementAt?: number;
  activeAt?: number;
  expiresAt?: number;
  winnerTeamId?: string;
  claimedAt?: number;
  awardReceipt?: {
    averageCO2Kg?: number;
    winnerCO2Kg?: number;
    multiplierBasisPoints?: number;
    grossRevenueCents?: number;
    netRevenueCents?: number;
  };
}

export interface ProjectWork {
  projectId: string;
  municipalityReady: boolean;
  mrfReady: boolean;
  brokerReady: boolean;
  sitePlan?: string;
  certification?: string;
  procurementPlan?: string;
  workRevision?: number;
  plannedMaterialsKg?: Record<Material, number>;
}

export interface MrfActionGuide {
  mode: "rapid" | "balanced" | "quality" | "hold" | "landfill";
  durationMs: number;
  grade: "A" | "B" | "C" | null;
  recoveredKg: number;
  residueKg: number;
  totalCostCents: number;
  totalCO2Kg: number;
  healthDelta?: number;
  recoveryRateBasisPoints: number;
}

export interface ChatMessage {
  _id: string;
  senderRole: string;
  content: string;
  createdAtMs: number;
}

export interface PublicLeaderboardEntry {
  teamId: string;
  citySlot: number;
  name?: string;
}

export type CityTransitKind = "collection" | "processing" | "trade";

export interface CityTransit {
  id: string;
  kind: CityTransitKind;
  material?: Material;
  route: "express" | "standard" | "consolidated" | "low-carbon";
  arrivesAt: number;
}

export interface CityTransferEffect {
  id: string;
  kind:
    | "external-purchase"
    | "processed-material"
    | "trade-delivery"
    | "project-delivery";
  material?: Material;
  createdAt: number;
  durationMs: number;
}

export interface CityProject {
  id: string;
  sequence: number;
  status: GameProject["status"];
  title: string;
  tier: number;
  expiresAt?: number;
  isTeamWinner: boolean;
}

export interface CityRenderModel {
  role: Role;
  status: string;
  health: number;
  inventoryKg: Record<Material, number>;
  waste: {
    available: number;
    queued: number;
    processing: number;
  };
  transits: CityTransit[];
  projects: CityProject[];
  hasCityCareMission: boolean;
  activeTradeCount: number;
}
