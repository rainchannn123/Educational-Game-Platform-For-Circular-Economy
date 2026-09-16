import mongoose, { Schema, model } from "mongoose";

const timestamps = { timestamps: true };
const inventorySchema = new Schema(
  {
    A: { type: Number, default: 0 },
    B: { type: Number, default: 0 },
    C: { type: Number, default: 0 },
    lockedKg: { type: Number, default: 0 },
    lockedA: { type: Number, default: 0 },
    lockedB: { type: Number, default: 0 },
    lockedC: { type: Number, default: 0 },
  },
  { _id: false },
);
const inventory = {
  paper: { type: inventorySchema, default: () => ({}) },
  plastic: { type: inventorySchema, default: () => ({}) },
  metal: { type: inventorySchema, default: () => ({}) },
  glass: { type: inventorySchema, default: () => ({}) },
  wood: { type: inventorySchema, default: () => ({}) },
};

export const User: any =
  mongoose.models.User ??
  model(
    "User",
    new Schema(
      {
        displayName: {
          type: String,
          required: true,
          trim: true,
          maxlength: 80,
        },
        email: { type: String, required: true, lowercase: true, unique: true },
        passwordHash: { type: String, required: true },
        roles: { type: [String], default: ["student"] },
        accessibility: {
          reducedMotion: Boolean,
          highContrast: Boolean,
          fontScale: { type: Number, default: 1 },
        },
      },
      timestamps,
    ),
  );
export const Team: any =
  mongoose.models.Team ??
  model(
    "Team",
    new Schema(
      {
        name: { type: String, required: true, maxlength: 50 },
        inviteCode: {
          type: String,
          required: true,
          unique: true,
          immutable: true,
        },
        leaderUserId: { type: String, required: true },
        members: [
          {
            userId: String,
            displayName: String,
            role: { type: String, default: null },
            ready: { type: Boolean, default: false },
          },
        ],
        status: { type: String, default: "forming" },
      },
      timestamps,
    ),
  );
export const Room: any =
  mongoose.models.Room ??
  model(
    "Room",
    new Schema(
      {
        code: { type: String, required: true, unique: true },
        name: String,
        ownerUserId: String,
        facilitatorUserId: String,
        scenarioId: { type: String, default: "standard-urban-rush-v1" },
        maxTeams: { type: Number, default: 30 },
        status: { type: String, default: "waiting" },
        seating: [
          {
            teamId: String,
            citySlot: Number,
            joinedAt: Number,
            readyAt: Number,
          },
        ],
      },
      timestamps,
    ),
  );
export const Game: any =
  mongoose.models.Game ??
  model(
    "Game",
    new Schema(
      {
        roomId: { type: String, required: true, unique: true },
        seed: Number,
        configSnapshot: Schema.Types.Mixed,
        status: { type: String, default: "scheduled" },
        startedAt: Number,
        activeStartedAt: Number,
        activeEndsAt: Number,
        finalizationEndsAt: Number,
        completedAt: Number,
        pausedAt: Number,
        schedulerLeaseUntil: Number,
        schedulerLeaseOwner: String,
        nextScheduledAt: Number,
        lastWasteTick: { type: Number, default: 0 },
        lastHealthMissionSlot: { type: Number, default: -1 },
        globalRevision: { type: Number, default: 0 },
        participantTeamIds: [String],
        projectCursor: { type: Number, default: 0 },
        projectPreviewCursor: { type: Number, default: 0 },
        activeProjectCount: { type: Number, default: 0 },
      },
      timestamps,
    ),
  );
export const GameTeamState: any =
  mongoose.models.GameTeamState ??
  model(
    "GameTeamState",
    new Schema(
      {
        gameId: { type: String, required: true },
        teamId: { type: String, required: true },
        citySlot: Number,
        memberRoles: Schema.Types.Mixed,
        walletCents: Number,
        lockedCashCents: { type: Number, default: 0 },
        reservedCashCents: { type: Number, default: 0 },
        health: Number,
        healthRecoveryUntil: { type: Number, default: null },
        totalCO2Kg: Number,
        status: { type: String, default: "active" },
        revision: { type: Number, default: 0 },
        inventory,
        roleInventories: { type: Schema.Types.Mixed, default: () => ({}) },
        provenance: Schema.Types.Mixed,
        metrics: Schema.Types.Mixed,
        lastProjectClaimedAt: Number,
        nextWasteAt: Number,
        wasteSpawnSequence: { type: Number, default: 0 },
      },
      timestamps,
    ).index({ gameId: 1, teamId: 1 }, { unique: true }),
  );
export const WasteSource: any =
  mongoose.models.WasteSource ??
  model(
    "WasteSource",
    new Schema(
      {
        gameId: String,
        teamId: String,
        massKg: Number,
        compositionKg: Schema.Types.Mixed,
        contaminationBasisPoints: Number,
        status: String,
        expiresAt: Number,
        transitArrivesAt: Number,
        queueArrivedAt: Number,
        holdExpiresAt: Number,
        parentWasteSourceId: String,
        decomposedAt: Number,
      },
      timestamps,
    ).index({ status: 1, expiresAt: 1 }),
  );
export const Transport: any =
  mongoose.models.Transport ??
  model(
    "Transport",
    new Schema(
      {
        gameId: String,
        teamId: String,
        wasteSourceId: String,
        route: String,
        arrivesAt: Number,
        status: { type: String, default: "in_transit" },
      },
      timestamps,
    ).index({ status: 1, arrivesAt: 1 }),
  );
export const ProcessJob: any =
  mongoose.models.ProcessJob ??
  model(
    "ProcessJob",
    new Schema(
      {
        gameId: String,
        teamId: String,
        wasteSourceId: String,
        methodId: String,
        result: Schema.Types.Mixed,
        dueAt: Number,
        status: { type: String, default: "processing" },
      },
      timestamps,
    ).index({ status: 1, dueAt: 1 }),
  );
export const MaterialTransfer: any =
  mongoose.models.MaterialTransfer ??
  model(
    "MaterialTransfer",
    new Schema(
      {
        gameId: { type: String, required: true },
        teamId: { type: String, required: true },
        commandId: { type: String, required: true },
        fromRole: { type: String, required: true },
        toRole: { type: String, required: true },
        materialType: { type: String, required: true },
        grade: { type: String, required: true },
        quantityKg: { type: Number, required: true },
        route: { type: String, required: true },
        costCents: { type: Number, required: true },
        co2Kg: { type: Number, required: true },
        departedAt: { type: Number, required: true },
        arrivesAt: { type: Number, required: true },
        status: { type: String, default: "in_transit" },
        completedAt: Number,
      },
      timestamps,
    )
      .index({ status: 1, arrivesAt: 1 })
      .index({ gameId: 1, teamId: 1, commandId: 1 }, { unique: true }),
  );
export const GameProject: any =
  mongoose.models.GameProject ??
  model(
    "GameProject",
    new Schema(
      {
        gameId: String,
        sequence: Number,
        templateId: String,
        template: Schema.Types.Mixed,
        status: String,
        previewAt: Number,
        announcementAt: Number,
        activeAt: Number,
        expiresAt: Number,
        winnerTeamId: String,
        claimedAt: Number,
        awardReceipt: Schema.Types.Mixed,
      },
      timestamps,
    ).index({ gameId: 1, sequence: 1 }, { unique: true }),
  );
export const ProjectWork: any =
  mongoose.models.ProjectWork ??
  model(
    "ProjectWork",
    new Schema(
      {
        gameId: String,
        projectId: String,
        teamId: String,
        municipalityReady: { type: Boolean, default: false },
        mrfReady: { type: Boolean, default: false },
        brokerReady: { type: Boolean, default: false },
        municipalityReadyByUserId: String,
        mrfReadyByUserId: String,
        brokerReadyByUserId: String,
        municipalityReadyAt: Number,
        mrfReadyAt: Number,
        brokerReadyAt: Number,
        sitePlan: String,
        certification: String,
        procurementPlan: String,
        plannedMaterialsKg: Schema.Types.Mixed,
        workRevision: { type: Number, default: 0 },
        status: { type: String, default: "open" },
      },
      timestamps,
    ).index({ projectId: 1, teamId: 1 }, { unique: true }),
  );
export const TradeOffer: any =
  mongoose.models.TradeOffer ??
  model(
    "TradeOffer",
    new Schema(
      {
        gameId: String,
        offeringTeamId: String,
        recipientTeamId: String,
        terms: Schema.Types.Mixed,
        status: { type: String, default: "open" },
        parentTradeOfferId: String,
        expiresAt: Number,
        deliveryDueAt: Number,
        settlement: Schema.Types.Mixed,
      },
      timestamps,
    ).index({ gameId: 1, status: 1, expiresAt: 1 }),
  );
export const HealthMission: any =
  mongoose.models.HealthMission ??
  model(
    "HealthMission",
    new Schema(
      {
        gameId: String,
        teamId: String,
        templateId: String,
        status: { type: String, default: "active" },
        steps: Schema.Types.Mixed,
        expiresAt: Number,
        completedAt: Number,
        healthDelta: Number,
      },
      timestamps,
    ).index({ gameId: 1, teamId: 1, status: 1 }),
  );
export const GameResultTeam: any =
  mongoose.models.GameResultTeam ??
  model(
    "GameResultTeam",
    new Schema(
      {
        gameId: { type: String, required: true },
        teamId: { type: String, required: true },
        rank: { type: Number, required: true },
        citySlot: Number,
        walletCents: Number,
        totalCO2Kg: Number,
        health: Number,
        lastProjectClaimedAt: Number,
        metrics: Schema.Types.Mixed,
        provenance: Schema.Types.Mixed,
      },
      timestamps,
    ).index({ gameId: 1, teamId: 1 }, { unique: true }),
  );
export const ChatMessage: any =
  mongoose.models.ChatMessage ??
  model(
    "ChatMessage",
    new Schema(
      {
        gameId: String,
        teamId: String,
        channel: String,
        senderUserId: String,
        senderName: String,
        senderRole: String,
        content: String,
        createdAtMs: Number,
      },
      timestamps,
    ).index({ gameId: 1, teamId: 1, channel: 1, createdAtMs: -1 }),
  );
export const GameAnnouncement: any =
  mongoose.models.GameAnnouncement ??
  model(
    "GameAnnouncement",
    new Schema(
      {
        gameId: { type: String, required: true },
        key: { type: String, required: true },
        type: { type: String, required: true },
        message: { type: String, required: true },
        payload: Schema.Types.Mixed,
        createdAtMs: { type: Number, required: true },
      },
      timestamps,
    )
      .index({ gameId: 1, key: 1 }, { unique: true })
      .index({ gameId: 1, createdAtMs: -1 }),
  );
export const ActivityEvent: any =
  mongoose.models.ActivityEvent ??
  model(
    "ActivityEvent",
    new Schema(
      {
        gameId: String,
        teamId: String,
        actorType: String,
        actorUserId: String,
        actorRole: String,
        type: String,
        occurredAt: Number,
        commandId: String,
        visibility: String,
        payload: Schema.Types.Mixed,
      },
      timestamps,
    ).index({ gameId: 1, occurredAt: 1 }),
  );
export const OutboxEvent: any =
  mongoose.models.OutboxEvent ??
  model(
    "OutboxEvent",
    new Schema(
      {
        gameId: String,
        eventType: String,
        target: String,
        payload: Schema.Types.Mixed,
        gameRevision: Number,
        createdAtMs: Number,
        publishedAt: Number,
        leaseUntil: Number,
        leaseOwner: String,
        attempts: { type: Number, default: 0 },
      },
      timestamps,
    ).index({ publishedAt: 1, leaseUntil: 1, createdAt: 1 }),
  );
export const Idempotency: any =
  mongoose.models.Idempotency ??
  model(
    "Idempotency",
    new Schema(
      {
        key: { type: String, required: true, unique: true },
        userId: String,
        method: String,
        path: String,
        bodyHash: String,
        response: Schema.Types.Mixed,
        statusCode: Number,
        status: { type: String, default: "completed" },
      },
      timestamps,
    ),
  );
