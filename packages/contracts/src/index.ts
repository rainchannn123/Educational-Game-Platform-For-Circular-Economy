import { z } from "zod";

export const ROLE_VALUES = ["municipality", "mrf", "broker"] as const;
export const MATERIAL_VALUES = [
  "paper",
  "plastic",
  "metal",
  "glass",
  "wood",
] as const;
export const GRADE_VALUES = ["A", "B", "C"] as const;
export const GAME_STATUS_VALUES = [
  "scheduled",
  "briefing",
  "active",
  "finalizing",
  "completed",
  "cancelled",
  "paused",
] as const;

export const roleSchema = z.enum(ROLE_VALUES);
export const materialSchema = z.enum(MATERIAL_VALUES);
export const gradeSchema = z.enum(GRADE_VALUES);
export const gameStatusSchema = z.enum(GAME_STATUS_VALUES);
export const commandIdSchema = z.string().uuid();
export const positiveHundredKgSchema = z
  .number()
  .int()
  .min(100)
  .max(10_000)
  .multipleOf(100);
export const materialMapSchema = z.object({
  paper: z.number().int().min(0),
  plastic: z.number().int().min(0),
  metal: z.number().int().min(0),
  glass: z.number().int().min(0),
  wood: z.number().int().min(0),
});
export const commandEnvelopeSchema = z.object({
  commandId: commandIdSchema,
  expectedTeamRevision: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown()),
});
export const routeSchema = z.enum(["express", "standard", "consolidated"]);
export const PROCESSING_METHOD_VALUES = [
  "paper-hydropulp-deink",
  "plastic-sort-pelletize",
  "metal-eddy-remelt",
  "glass-cullet-remelt",
  "wood-chip-board",
  "landfill",
  "incineration",
] as const;
export const processingMethodSchema = z.enum(PROCESSING_METHOD_VALUES);
export const deliveryModeSchema = z.enum(["standard", "low-carbon"]);
export const pingTypeSchema = z.enum([
  "need-material",
  "batch-dispatched",
  "material-ready",
  "please-certify",
  "project-ready",
  "trade-offer",
  "health-urgent",
  "blocked",
  "acknowledged",
]);

export type Role = z.infer<typeof roleSchema>;
export type Material = z.infer<typeof materialSchema>;
export type Grade = z.infer<typeof gradeSchema>;
export type GameStatus = z.infer<typeof gameStatusSchema>;
export type Route = z.infer<typeof routeSchema>;
export type ProcessingMethodId = z.infer<typeof processingMethodSchema>;
export type DeliveryMode = z.infer<typeof deliveryModeSchema>;
export type MaterialMap = z.infer<typeof materialMapSchema>;
export type PingType = z.infer<typeof pingTypeSchema>;

export interface MaterialInventory {
  A: number;
  B: number;
  C: number;
  lockedKg: number;
  lockedA: number;
  lockedB: number;
  lockedC: number;
}
export type Inventory = Record<Material, MaterialInventory>;
export type RoleInventories = Record<Role, Inventory>;
export interface Actor {
  userId: string;
  roles: string[];
}
export interface DomainEvent<T = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  gameId: string;
  occurredAt: number;
  gameRevision: number;
  payload: T;
}
export interface ApiSuccess<T> {
  success: true;
  data: T;
}
export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    snapshotRequired?: boolean;
    details?: Record<string, unknown>;
  };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const dispatchCollectionSchema = z.object({
  commandId: commandIdSchema,
  expectedTeamRevision: z.number().int().nonnegative(),
  payload: z.object({ wasteSourceId: z.string().min(1), route: routeSchema }),
});
export const processWasteSchema = z.object({
  commandId: commandIdSchema,
  expectedTeamRevision: z.number().int().nonnegative(),
  payload: z.object({
    wasteSourceId: z.string().min(1),
    methodId: processingMethodSchema,
  }),
});
export const decomposeWasteSchema = z.object({
  commandId: commandIdSchema,
  expectedTeamRevision: z.number().int().nonnegative(),
  payload: z.object({ wasteSourceId: z.string().min(1) }),
});
export const materialTransferSchema = z.object({
  commandId: commandIdSchema,
  expectedTeamRevision: z.number().int().nonnegative(),
  payload: z.object({
    toRole: roleSchema,
    materialType: materialSchema,
    grade: gradeSchema,
    quantityKg: z.number().int().min(1).max(10_000),
    route: routeSchema,
  }),
});
export const externalPurchaseSchema = z.object({
  commandId: commandIdSchema,
  expectedTeamRevision: z.number().int().nonnegative(),
  payload: z.object({
    materialType: materialSchema,
    quantityKg: positiveHundredKgSchema,
  }),
});
export const materialPlanSchema = z.object({
  commandId: commandIdSchema,
  expectedWorkRevision: z.number().int().nonnegative(),
  payload: z.object({ materials: materialMapSchema }),
});
export const readinessSchema = z.object({
  commandId: commandIdSchema,
  payload: z.object({ value: z.string().min(1) }),
});
export const claimSchema = z.object({
  commandId: commandIdSchema,
  expectedTeamRevision: z.number().int().nonnegative(),
  payload: z.object({ confirm: z.literal(true) }),
});
export const healthStepSchema = z.object({
  commandId: commandIdSchema,
  payload: z.object({ optionKey: z.string().min(1) }),
});
export const chatSchema = z.object({
  commandId: commandIdSchema,
  payload: z.object({
    channel: z.string().min(1),
    message: z.string().trim().min(1).max(500),
  }),
});
export const pingSchema = z.object({
  commandId: commandIdSchema,
  payload: z.object({
    type: pingTypeSchema,
    entityId: z.string().optional(),
    materialType: materialSchema.optional(),
    quantityKg: z.number().int().positive().optional(),
  }),
});
export const tradeTermsSchema = z.object({
  offered: z.object({
    materials: z
      .array(
        z.object({
          materialType: materialSchema,
          grade: gradeSchema,
          quantityKg: positiveHundredKgSchema,
        }),
      )
      .max(5),
    cashCents: z.number().int().nonnegative(),
  }),
  requested: z.object({
    materials: z
      .array(
        z.object({
          materialType: materialSchema,
          minimumGrade: gradeSchema,
          quantityKg: positiveHundredKgSchema,
        }),
      )
      .max(5),
    cashCents: z.number().int().nonnegative(),
  }),
  deliveryMode: deliveryModeSchema,
});
export const createTradeSchema = z.object({
  commandId: commandIdSchema,
  expectedTeamRevision: z.number().int().nonnegative(),
  payload: z.object({
    recipientTeamId: z.string().min(1),
    terms: tradeTermsSchema,
  }),
});

export const errorMessages: Record<string, string> = {
  STALE_TEAM_REVISION:
    "Your city state changed. Refreshing the latest game state.",
  GAME_NOT_ACCEPTING_ACTIONS:
    "The match is not accepting this action right now.",
  ROLE_NOT_AUTHORIZED: "This action belongs to another role workstation.",
  INSUFFICIENT_WALLET:
    "Your city does not have enough wallet balance for this action.",
  MRF_QUEUE_FULL:
    "The MRF queue is full. Process or wait for an incoming batch first.",
  PROCESSING_METHOD_INCOMPATIBLE:
    "This recycling method cannot safely process the selected batch.",
  MATERIAL_TRANSFER_INVALID:
    "Choose available material and a different teammate role.",
  MATERIAL_TRANSFER_UNAVAILABLE:
    "That material is no longer available in your role inventory.",
  WASTE_SOURCE_EXPIRED: "This waste source has already expired.",
  PROJECT_NOT_ACTIVE: "This project is not currently claimable.",
  PROJECT_ALREADY_CLAIMED: "Another city has already completed this project.",
  PROJECT_REQUIREMENTS_NOT_MET:
    "Your team is still missing required material or role confirmation.",
  HEALTH_TOO_LOW_TO_CLAIM:
    "City Health is too low to start another project. Complete City Care first.",
  TEAM_HEALTH_RECOVERY:
    "City Health is recovering. Your team can resume actions when the recovery timer ends.",
  TRADE_OFFER_EXPIRED: "This trade offer has expired.",
  TRADE_NOT_RECIPIENT:
    "Only the receiving team's Broker can accept this trade.",
  TRADE_VALUE_OUT_OF_RANGE:
    "The proposed exchange is outside the allowed fair-value range.",
  CHAT_RATE_LIMITED: "Please wait before sending another message.",
  PING_RATE_LIMITED: "Please wait before sending another ping.",
  CHATBOT_RATE_LIMITED: "The strategy assistant is taking a short break.",
  CHAT_CHANNEL_NOT_AUTHORIZED: "You do not have access to this conversation.",
  COMMAND_IN_PROGRESS: "This command is already being processed. Please retry shortly.",
  TEAM_INCOMPLETE:
    "Your city needs exactly three teammates before it can be ready.",
  ROLE_SELECTION_INCOMPLETE:
    "Every teammate must select a different role before readiness can be confirmed.",
  IDEMPOTENCY_KEY_REUSED:
    "This action key was already used for a different request.",
};
