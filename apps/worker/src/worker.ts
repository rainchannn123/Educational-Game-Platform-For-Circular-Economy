import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Emitter } from "@socket.io/redis-emitter";
import Redis from "ioredis";
import mongoose from "mongoose";
import type { Material, ProcessingMethodId } from "@circular-city/contracts";
import {
  HEALTH_MISSIONS,
  STANDARD_SCENARIO,
} from "@circular-city/game-content";
import {
  addMaterial,
  applyTeamHealthDelta,
  calculateRankings,
  calculateProcessing,
  emptyRoleInventories,
  HEALTH_RECOVERY_HEALTH,
  healthMissionDelta,
  healthStatus,
  materialKeys,
  type TeamState,
} from "@circular-city/game-engine";
import {
  dueScheduleSlots,
  dueTimeAnnouncements,
  healthMissionForSlot,
  projectForSequence,
  wasteSpawnIntervalMs,
} from "./scheduler.js";
import { readEnv } from "../../api/src/env.js";
import { connectMongo } from "../../api/src/database.js";
import {
  ActivityEvent,
  Game,
  GameAnnouncement,
  GameResultTeam,
  GameProject,
  GameTeamState,
  HealthMission,
  MaterialTransfer,
  OutboxEvent,
  ProcessJob,
  QualityUpgradeJob,
  TradeOffer,
  Transport,
  WasteSource,
} from "../../api/src/models.js";

const env = readEnv();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
redis.on("error", (error) =>
  console.error("Redis emitter unavailable; retrying", error.message),
);
const emitter = new Emitter(redis);
const instanceId = `worker_${randomUUID()}`;
const now = (): number => Date.now();
const materialMap = () => ({
  paper: 0,
  plastic: 0,
  metal: 0,
  glass: 0,
  wood: 0,
});
const recoveryMethodByMaterial: Record<Material, ProcessingMethodId> = {
  paper: "paper-hydropulp-deink",
  plastic: "plastic-sort-pelletize",
  metal: "metal-eddy-remelt",
  glass: "glass-cullet-remelt",
  wood: "wood-chip-board",
};
const methodForLegacyJob = (job: any, source: any): ProcessingMethodId => {
  if (job.methodId) return job.methodId;
  if (job.mode === "landfill") return "landfill";
  const dominant = materialKeys
    .map((material) => ({ material, kg: source.compositionKg?.[material] ?? 0 }))
    .sort((left, right) => right.kg - left.kg)[0]?.material;
  return recoveryMethodByMaterial[dominant ?? "paper"];
};
const due = async (
  gameId: string,
  type: string,
  payload: Record<string, unknown>,
  target = `game:${gameId}`,
  session?: mongoose.ClientSession,
): Promise<void> => {
  const game = await Game.findByIdAndUpdate(
    gameId,
    { $inc: { globalRevision: 1 } },
    { new: true, session },
  ).lean();
  await OutboxEvent.create(
    [
      {
        gameId,
        eventType: type,
        target,
        payload,
        gameRevision: game?.globalRevision ?? 0,
        createdAtMs: now(),
      },
    ],
    { session },
  );
};
const activity = async (
  gameId: string,
  teamId: string | undefined,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  await ActivityEvent.create({
    gameId,
    teamId,
    type,
    actorType: "system",
    occurredAt: now(),
    visibility: "facilitator",
    payload,
  });
};
const announce = async (
  gameId: string,
  key: string,
  type: "time" | "project-win",
  message: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  let announcement: any;
  try {
    announcement = await GameAnnouncement.create({
      gameId,
      key,
      type,
      message,
      payload,
      createdAtMs: now(),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return;
    throw error;
  }
  await due(
    gameId,
    "announcement.created",
    { announcement: announcement.toObject() },
  );
};
const seeded = (seed: number, cursor: number): number =>
  ((seed * 1103515245 + cursor * 12345) >>> 0) % 10000;
const inferActiveStartAt = (game: any): number => {
  if (typeof game.activeStartedAt === "number") return game.activeStartedAt;
  if (
    typeof game.startedAt === "number" &&
    typeof game.activeEndsAt === "number" &&
    game.activeEndsAt - game.startedAt > STANDARD_SCENARIO.activeMs
  )
    return game.startedAt + STANDARD_SCENARIO.briefingMs;
  return typeof game.startedAt === "number" ? game.startedAt : now();
};

async function ensureInitialProject(game: any): Promise<void> {
  const gameId = String(game._id);
  const existing = await GameProject.findOne({ gameId, sequence: 1 }).lean();
  if (existing) {
    if (game.projectCursor !== 1 || game.projectPreviewCursor !== 1) {
      game.projectCursor = 1;
      game.projectPreviewCursor = 1;
      await Game.updateOne(
        { _id: game._id },
        { $set: { projectCursor: 1, projectPreviewCursor: 1 } },
      );
    }
    return;
  }
  const activeAt = inferActiveStartAt(game);
  const template = projectForSequence(game.seed, 1);
  let project = await GameProject.findOne({ gameId, sequence: 1 }).lean();
  if (!project)
    try {
      project = await GameProject.create({
        gameId,
        sequence: 1,
        templateId: template.id,
        template,
        status: "active",
        previewAt: activeAt,
        announcementAt: activeAt,
        activeAt,
        expiresAt: activeAt + template.activeDurationMs,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      project = await GameProject.findOne({ gameId, sequence: 1 }).lean();
    }
  if (!project) return;
  await Game.updateOne(
    { _id: game._id },
    { $set: { projectCursor: 1, projectPreviewCursor: 1 } },
  );
  game.projectCursor = 1;
  game.projectPreviewCursor = 1;
    await activity(gameId, undefined, "project.announced", {
    projectId: String(project._id),
    sequence: 1,
  });
  const projectPayload =
    typeof (project as any).toObject === "function"
      ? (project as any).toObject()
      : project;
  await due(gameId, "project.announced", { project: projectPayload });
}

const nextWasteIntervalMs = (
  game: any,
  citySlot: number,
  sequence: number,
): number => {
  const minimum = STANDARD_SCENARIO.wasteSpawnMinMs;
  const maximum = STANDARD_SCENARIO.wasteSpawnMaxMs;
  return wasteSpawnIntervalMs(game.seed ?? 0, citySlot, sequence, minimum, maximum);
};

async function spawnWaste(
  game: any,
  state: { teamId: string; citySlot: number },
  sequence: number,
): Promise<void> {
  const visible = await WasteSource.countDocuments({
    gameId: String(game._id),
    teamId: state.teamId,
    status: "available",
  });
  if (visible >= STANDARD_SCENARIO.wasteVisibleCap) return;
  const templates = [
      {
        mass: [4000, 5500],
        composition: {
          paper: 5000,
          plastic: 2500,
          metal: 0,
          glass: 2500,
          wood: 0,
        },
        contamination: 500,
      },
      {
        mass: [4500, 6000],
        composition: {
          paper: 4500,
          plastic: 3000,
          metal: 0,
          glass: 2000,
          wood: 500,
        },
        contamination: 1800,
      },
      {
        mass: [4000, 6500],
        composition: {
          paper: 4000,
          plastic: 4000,
          metal: 2000,
          glass: 0,
          wood: 0,
        },
        contamination: 1000,
      },
      {
        mass: [4500, 7000],
        composition: {
          paper: 0,
          plastic: 2500,
          metal: 4500,
          glass: 0,
          wood: 3000,
        },
        contamination: 800,
      },
      {
        mass: [5000, 7500],
        composition: {
          paper: 0,
          plastic: 1000,
          metal: 3500,
          glass: 2500,
          wood: 3000,
        },
        contamination: 1500,
      },
      {
        mass: [3500, 5000],
        composition: {
          paper: 5500,
          plastic: 2500,
          metal: 0,
          glass: 2000,
          wood: 0,
        },
        contamination: 1200,
      },
  ];
  const sourceTemplate =
    templates[
      seeded(game.seed ?? 0, state.citySlot * 101 + sequence) % templates.length
    ]!;
  const mass =
    sourceTemplate.mass[0] +
    (seeded(game.seed ?? 0, state.citySlot * 211 + sequence) %
      (sourceTemplate.mass[1] - sourceTemplate.mass[0] + 1));
  const composition = materialMap();
  let remainder = mass;
  const nonZero = Object.entries(sourceTemplate.composition).filter(
    ([, amount]) => amount > 0,
  );
  nonZero.forEach(([material, percent], index) => {
    const amount =
      index === nonZero.length - 1
        ? remainder
        : Math.floor((mass * percent) / 10000);
    composition[material as keyof typeof composition] = amount;
    remainder -= amount;
  });
  const source = await WasteSource.create({
    gameId: String(game._id),
    teamId: state.teamId,
    massKg: mass,
    compositionKg: composition,
    contaminationBasisPoints: sourceTemplate.contamination,
    status: "available",
    expiresAt: now() + STANDARD_SCENARIO.wasteExpiryMs,
  });
  await due(
    String(game._id),
    "waste.spawned",
    { wasteSource: source.toObject() },
    `team:${game._id}:${state.teamId}`,
  );
}

async function scheduleWaste(game: any, current: number): Promise<void> {
  const states = await GameTeamState.find({
    gameId: String(game._id),
    status: { $ne: "withdrawn" },
  }).lean();
  for (const state of states) {
    const sequence = state.wasteSpawnSequence ?? 0;
    const nextWasteAt =
      state.nextWasteAt ??
      current + nextWasteIntervalMs(game, state.citySlot, sequence);
    if (state.nextWasteAt === undefined || state.nextWasteAt === null) {
      await GameTeamState.updateOne(
        {
          _id: state._id,
          $or: [{ nextWasteAt: { $exists: false } }, { nextWasteAt: null }],
        },
        { $set: { nextWasteAt, wasteSpawnSequence: sequence } },
      );
      continue;
    }
    if (nextWasteAt > current) continue;
    await spawnWaste(game, state, sequence);
    const nextSequence = sequence + 1;
    await GameTeamState.updateOne(
      { _id: state._id, nextWasteAt },
      {
        $set: {
          nextWasteAt:
            current + nextWasteIntervalMs(game, state.citySlot, nextSequence),
          wasteSpawnSequence: nextSequence,
        },
      },
    );
  }
}

async function ensureTimeAnnouncements(
  game: any,
  current: number,
): Promise<void> {
  if (typeof game.activeEndsAt !== "number" || current >= game.activeEndsAt)
    return;
  for (const milestone of dueTimeAnnouncements(game.activeEndsAt, current)) {
    await announce(
      String(game._id),
      `time:${milestone.remainingMs}`,
      "time",
      milestone.message,
      { remainingMs: milestone.remainingMs },
    );
  }
}

async function advanceGame(game: any): Promise<void> {
  const current = now();
  if (game.status === "scheduled" && current >= game.startedAt) {
    game.status = "briefing";
    game.nextScheduledAt = game.startedAt + STANDARD_SCENARIO.briefingMs;
    await game.save();
    await activity(String(game._id), undefined, "game.lifecycle.briefing", {});
    await due(String(game._id), "game.status.changed", { status: "briefing" });
    return;
  }
  if (game.status === "briefing") {
    const activeStarts = game.startedAt + STANDARD_SCENARIO.briefingMs;
    if (current >= activeStarts) {
      game.status = "active";
      game.activeStartedAt = activeStarts;
      game.activeEndsAt = activeStarts + STANDARD_SCENARIO.activeMs;
      game.finalizationEndsAt =
        game.activeEndsAt + STANDARD_SCENARIO.finalizationMs;
      game.nextScheduledAt = activeStarts;
      await game.save();
      await ensureInitialProject(game);
      await due(String(game._id), "game.status.changed", {
        status: "active",
        activeEndsAt: game.activeEndsAt,
      });
    }
    return;
  }
  if (game.status === "active" && current >= game.activeEndsAt) {
    game.status = "finalizing";
    game.nextScheduledAt = game.finalizationEndsAt;
    const openOffers = await TradeOffer.find({
      gameId: String(game._id),
      status: "open",
    }).lean();

    for (const offer of openOffers) {
      const release: Record<string, number> = {
        lockedCashCents: -(offer.terms.offered.cashCents ?? 0),
      };

      for (const line of offer.terms.offered.materials) {
        const key = `inventory.${line.materialType}.lockedKg`;
        release[key] = (release[key] ?? 0) - line.quantityKg;
        const gradeKey = `inventory.${line.materialType}.locked${line.grade}`;
        release[gradeKey] = (release[gradeKey] ?? 0) - line.quantityKg;
        release[`roleInventories.broker.${line.materialType}.lockedKg`] =
          (release[`roleInventories.broker.${line.materialType}.lockedKg`] ?? 0) -
          line.quantityKg;
        const roleGradeKey = `roleInventories.broker.${line.materialType}.locked${line.grade}`;
        release[roleGradeKey] =
          (release[roleGradeKey] ?? 0) - line.quantityKg;
      }

      const cancelled = await TradeOffer.updateOne(
        { _id: offer._id, status: "open" },
        { $set: { status: "cancelled" } },
      );

      if (cancelled.modifiedCount) {
        await GameTeamState.updateOne(
          { gameId: offer.gameId, teamId: offer.offeringTeamId },
          { $inc: release },
        );
        await due(
          offer.gameId,
          "trade.offer.updated",
          { offerId: String(offer._id), status: "cancelled" },
          `trade:${offer.gameId}:${String(offer._id)}`,
        );
      }
    }
    await game.save();
    await due(String(game._id), "game.status.changed", {
      status: "finalizing",
    });
    return;
  }
  if (game.status === "finalizing" && current >= game.finalizationEndsAt) {
    game.status = "completed";
    game.completedAt = current;
    await GameProject.updateMany(
      {
        gameId: String(game._id),
        status: { $in: ["active", "queued", "announced"] },
      },
      { $set: { status: "expired" } },
    );
    const rankedTeams = calculateRankings(
      (await GameTeamState.find({ gameId: String(game._id) }).lean()) as TeamState[],
    ) as Array<TeamState & { teamId: string }>;
    await GameResultTeam.bulkWrite(
      rankedTeams.map((team, index) => ({
        updateOne: {
          filter: { gameId: String(game._id), teamId: team.teamId },
          update: {
            $setOnInsert: {
              gameId: String(game._id),
              teamId: team.teamId,
              rank: index + 1,
              citySlot: team.citySlot,
              walletCents: team.walletCents,
              totalCO2Kg: team.totalCO2Kg,
              health: team.health,
              lastProjectClaimedAt: team.lastProjectClaimedAt,
              metrics: team.metrics,
              provenance: team.provenance,
            },
          },
          upsert: true,
        },
      })),
    );
    await game.save();
    await due(String(game._id), "game.status.changed", { status: "completed" });
    return;
  }
  if (game.status !== "active") return;
  await ensureTimeAnnouncements(game, current);
  const activeStartedAt = inferActiveStartAt(game);
  if (game.activeStartedAt !== activeStartedAt) {
    game.activeStartedAt = activeStartedAt;
    await game.save();
  }
  await ensureInitialProject(game);
  const activeElapsed = current - activeStartedAt;
  let nextPreviewSequence = (game.projectPreviewCursor ?? 1) + 1;
  let nextAnnouncementAt =
    (nextPreviewSequence - 1) * STANDARD_SCENARIO.projectAnnounceMs;
  let nextPreviewAt = nextAnnouncementAt - STANDARD_SCENARIO.projectPreviewMs;
  let createdPreview = false;
  while (
    activeElapsed >= nextPreviewAt &&
    nextAnnouncementAt < STANDARD_SCENARIO.stopAnnouncementsMs
  ) {
    const template = projectForSequence(game.seed, nextPreviewSequence);
    let project = await GameProject.findOne({
      gameId: String(game._id),
      sequence: nextPreviewSequence,
    }).lean();
    if (!project)
      try {
        project = await GameProject.create({
          gameId: String(game._id),
          sequence: nextPreviewSequence,
          templateId: template.id,
          template,
          status: "announced",
          previewAt: activeStartedAt + nextPreviewAt,
          announcementAt: activeStartedAt + nextAnnouncementAt,
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        project = await GameProject.findOne({
          gameId: String(game._id),
          sequence: nextPreviewSequence,
        }).lean();
      }
    if (!project) break;
    game.projectPreviewCursor = nextPreviewSequence;
    createdPreview = true;
    const projectPayload =
      typeof (project as any).toObject === "function"
        ? (project as any).toObject()
        : project;
    await due(String(game._id), "project.previewed", {
      project: projectPayload,
    });
    nextPreviewSequence += 1;
    nextAnnouncementAt =
      (nextPreviewSequence - 1) * STANDARD_SCENARIO.projectAnnounceMs;
    nextPreviewAt = nextAnnouncementAt - STANDARD_SCENARIO.projectPreviewMs;
  }
  if (createdPreview) await game.save();

  const dueAnnouncements = await GameProject.find({
    gameId: String(game._id),
    status: "announced",
    announcementAt: { $lte: current },
  }).sort({ sequence: 1 });

  for (const project of dueAnnouncements) {
    const activeCount = await GameProject.countDocuments({
      gameId: String(game._id),
      status: "active",
    });
    project.status =
      activeCount < STANDARD_SCENARIO.activeProjectCap ? "active" : "queued";
    if (project.status === "active") {
      project.activeAt = project.announcementAt;
      project.expiresAt = project.activeAt + project.template.activeDurationMs;
    }
    await project.save();
    game.projectCursor = Math.max(game.projectCursor ?? 0, project.sequence);
    await due(
      String(game._id),
      project.status === "active" ? "project.announced" : "project.queued",
      { project: project.toObject() },
    );
  }
  if (dueAnnouncements.length > 0) await game.save();
  const expired = await GameProject.find({
    gameId: String(game._id),
    status: "active",
    expiresAt: { $lte: current },
  });
  for (const project of expired) {
    project.status = "expired";
    await project.save();
    await due(String(game._id), "project.expired", {
      projectId: String(project._id),
    });
  }
  const activeCount = await GameProject.countDocuments({
    gameId: String(game._id),
    status: "active",
  });
  if (activeCount < STANDARD_SCENARIO.activeProjectCap) {
    const queued = await GameProject.findOne({
      gameId: String(game._id),
      status: "queued",
    }).sort({ sequence: 1 });
    if (queued) {
      queued.status = "active";
      queued.activeAt = current;
      queued.expiresAt = current + queued.template.activeDurationMs;
      await queued.save();
      await due(String(game._id), "project.activated", {
        projectId: String(queued._id),
        expiresAt: queued.expiresAt,
      });
    }
  }
  await scheduleWaste(game, current);

  if (activeElapsed >= STANDARD_SCENARIO.firstHealthMissionMs) {
    let lastMissionSlot = game.lastHealthMissionSlot ?? -1;
    for (const missionSlot of dueScheduleSlots(
      lastMissionSlot,
      activeElapsed,
      STANDARD_SCENARIO.firstHealthMissionMs,
      STANDARD_SCENARIO.healthMissionMs,
    )) {
      lastMissionSlot = missionSlot;
      const states = await GameTeamState.find({
        gameId: String(game._id),
        status: { $ne: "withdrawn" },
      }).lean();
      const scheduledAt =
        activeStartedAt +
        STANDARD_SCENARIO.firstHealthMissionMs +
        missionSlot * STANDARD_SCENARIO.healthMissionMs;
      for (const state of states) {
        if (
          await HealthMission.exists({
            gameId: String(game._id),
            teamId: state.teamId,
            status: "active",
          })
        )
          continue;
        const template = healthMissionForSlot(
          game.seed,
          state.citySlot,
          missionSlot,
        );
        const mission = await HealthMission.create({
          gameId: String(game._id),
          teamId: state.teamId,
          templateId: template.id,
          status: "active",
          steps: {},
          expiresAt: scheduledAt + STANDARD_SCENARIO.healthDeadlineMs,
        });
        await due(
          String(game._id),
          "health-mission.created",
          { mission },
          `team:${game._id}:${state.teamId}`,
        );
      }
    }
    if (game.lastHealthMissionSlot !== lastMissionSlot) {
      game.lastHealthMissionSlot = lastMissionSlot;
      await game.save();
    }
  }
}
async function settleDueEntities(): Promise<void> {
  const current = now();
  for (const zeroHealthTeam of await GameTeamState.find({
    health: { $lte: 0 },
    $or: [
      { healthRecoveryUntil: { $exists: false } },
      { healthRecoveryUntil: null },
    ],
  }).lean()) {
    const healthChange = applyTeamHealthDelta(
      zeroHealthTeam as TeamState,
      0,
      current,
    );
    const changed = await GameTeamState.updateOne(
      {
        _id: zeroHealthTeam._id,
        health: { $lte: 0 },
        $or: [
          { healthRecoveryUntil: { $exists: false } },
          { healthRecoveryUntil: null },
        ],
      },
      { $set: healthChange, $inc: { revision: 1 } },
    );
    if (!changed.modifiedCount) continue;
    await due(
      zeroHealthTeam.gameId,
      "team.health.recovery.started",
      {
        health: 0,
        healthRecoveryUntil: healthChange.healthRecoveryUntil,
      },
      `team:${zeroHealthTeam.gameId}:${zeroHealthTeam.teamId}`,
    );
  }
  for (const recoveringTeam of await GameTeamState.find({
    healthRecoveryUntil: { $lte: current },
  }).lean()) {
    const recovered = await GameTeamState.findOneAndUpdate(
      {
        _id: recoveringTeam._id,
        healthRecoveryUntil: { $lte: current },
      },
      {
        $set: {
          health: HEALTH_RECOVERY_HEALTH,
          status: healthStatus(HEALTH_RECOVERY_HEALTH),
        },
        $unset: { healthRecoveryUntil: 1 },
        $inc: { revision: 1 },
      },
      { new: true },
    ).lean();
    if (!recovered) continue;
    await due(
      recoveringTeam.gameId,
      "team.health.recovery.completed",
      { health: HEALTH_RECOVERY_HEALTH },
      `team:${recoveringTeam.gameId}:${recoveringTeam.teamId}`,
    );
  }
  for (const transport of await Transport.find({
    status: "in_transit",
    arrivesAt: { $lte: current },
  })) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const transportChanged = await Transport.updateOne(
          { _id: transport._id, status: "in_transit" },
          { $set: { status: "arrived" } },
          { session },
        );
        if (!transportChanged.modifiedCount) return;
        const sourceChanged = await WasteSource.updateOne(
          {
            _id: transport.wasteSourceId,
            teamId: transport.teamId,
            status: "in_transit",
          },
          {
            $set: { status: "at_mrf", queueArrivedAt: current },
            $unset: { transitArrivesAt: 1 },
          },
          { session },
        );
        if (!sourceChanged.modifiedCount)
          throw new Error(`Transport source ${transport.wasteSourceId} is unavailable`);
        await due(
          transport.gameId,
          "municipality.transport.updated",
          { wasteSourceId: transport.wasteSourceId, status: "at_mrf" },
          `team:${transport.gameId}:${transport.teamId}`,
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }
  for (const pendingTransfer of await MaterialTransfer.find({
    status: "in_transit",
    arrivesAt: { $lte: current },
  })) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const completedTransfer = await MaterialTransfer.findOneAndUpdate(
          { _id: pendingTransfer._id, status: "in_transit" },
          { $set: { status: "completed", completedAt: current } },
          { new: true, session },
        ).lean();
        if (!completedTransfer) return;
        const destinationPath = `roleInventories.${completedTransfer.toRole}.${completedTransfer.materialType}.${completedTransfer.grade}`;
        const destinationChanged = await GameTeamState.updateOne(
          {
            gameId: completedTransfer.gameId,
            teamId: completedTransfer.teamId,
          },
          {
            $inc: {
              [destinationPath]: completedTransfer.quantityKg,
              revision: 1,
            },
          },
          { session },
        );
        if (!destinationChanged.modifiedCount)
          throw new Error(`Transfer destination ${completedTransfer.teamId} is unavailable`);
        await due(
          completedTransfer.gameId,
          "material.transfer.updated",
          {
            transferId: String(completedTransfer._id),
            status: "completed",
            fromRole: completedTransfer.fromRole,
            toRole: completedTransfer.toRole,
            material: completedTransfer.materialType,
            grade: completedTransfer.grade,
            quantityKg: completedTransfer.quantityKg,
          },
          `team:${completedTransfer.gameId}:${completedTransfer.teamId}`,
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }
  for (const source of await WasteSource.find({
    status: "available",
    expiresAt: { $lte: current },
  })) {
    const changed = await WasteSource.updateOne(
      { _id: source._id, status: "available" },
      { $set: { status: "expired" } },
    );
    if (!changed.modifiedCount) continue;
    const team = await GameTeamState.findOne({
      gameId: source.gameId,
      teamId: source.teamId,
    });
    if (team) {
      const healthChange = applyTeamHealthDelta(team as TeamState, -4, current);
      Object.assign(team, healthChange);
      team.revision += 1;
      await team.save();
    }
    await activity(source.gameId, source.teamId, "waste.expired", {
      wasteSourceId: String(source._id),
      healthDelta: -4,
    });
    await due(
      source.gameId,
      "team.metrics.updated",
      {
        healthDelta: -4,
        reason: "waste-expired",
        healthRecoveryUntil: team?.healthRecoveryUntil ?? null,
      },
      `team:${source.gameId}:${source.teamId}`,
    );
  }
  for (const job of await ProcessJob.find({
    status: "processing",
    dueAt: { $lte: current },
  })) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const activeJob = await ProcessJob.findOne({
          _id: job._id,
          status: "processing",
        })
          .session(session)
          .lean();
        if (!activeJob) return;
        const source = await WasteSource.findOne({
          _id: activeJob.wasteSourceId,
          status: "processing",
        })
          .session(session)
          .lean();
        const team = await GameTeamState.findOne({
          gameId: activeJob.gameId,
          teamId: activeJob.teamId,
        }).session(session);
        if (!source || !team)
          throw new Error(`MRF process ${activeJob._id} cannot be settled`);

        const methodId = methodForLegacyJob(activeJob, source);
        const result = activeJob.result ?? calculateProcessing(source as any, methodId);
        if (!team.roleInventories?.mrf) {
          const defaults = emptyRoleInventories();
          team.roleInventories = { ...defaults, ...(team.roleInventories ?? {}) };
        }
        if (result.grade)
          for (const material of materialKeys)
            if (result.outputKg[material] > 0) {
              addMaterial(team.inventory, material, result.grade, result.outputKg[material]);
              addMaterial(
                team.roleInventories.mrf,
                material,
                result.grade,
                result.outputKg[material],
              );
            }
        team.markModified("roleInventories");
        const healthChange = applyTeamHealthDelta(
          team as TeamState,
          result.healthDelta,
          current,
        );
        Object.assign(team, healthChange);
        const recoveredKg = materialKeys.reduce(
          (sum, material) => sum + result.outputKg[material],
          0,
        );
        team.metrics.recoveredKg += recoveredKg;
        team.metrics.landfilledKg += result.residueKg;
        team.provenance.recoveredKg += recoveredKg;
        team.revision += 1;
        await team.save({ session });

        const sourceChanged = await WasteSource.updateOne(
          { _id: source._id, status: "processing" },
          {
            $set: {
              status: methodId === "landfill" ? "landfilled" : "processed",
            },
          },
          { session },
        );
        if (!sourceChanged.modifiedCount)
          throw new Error(`MRF stream ${source._id} is unavailable`);
        if (source.parentWasteSourceId) {
          const activeSiblingCount = await WasteSource.countDocuments({
            parentWasteSourceId: source.parentWasteSourceId,
            status: { $in: ["held", "processing"] },
          }).session(session);
          if (activeSiblingCount === 0)
            await WasteSource.updateOne(
              { _id: source.parentWasteSourceId, status: "decomposed" },
              { $set: { status: "processed" } },
              { session },
            );
        }
        const jobChanged = await ProcessJob.updateOne(
          { _id: activeJob._id, status: "processing" },
          { $set: { status: "completed" } },
          { session },
        );
        if (!jobChanged.modifiedCount)
          throw new Error(`MRF process ${activeJob._id} was already settled`);
        await due(
          activeJob.gameId,
          "mrf.processing.updated",
          {
            wasteSourceId: String(source._id),
            methodId,
            status: "completed",
            result,
            healthRecoveryUntil: team.healthRecoveryUntil,
          },
          `team:${activeJob.gameId}:${activeJob.teamId}`,
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }
  for (const job of await QualityUpgradeJob.find({
    status: "processing",
    dueAt: { $lte: current },
  })) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const completedJob = await QualityUpgradeJob.findOneAndUpdate(
          { _id: job._id, status: "processing" },
          { $set: { status: "completed", completedAt: current } },
          { new: true, session },
        ).lean();
        if (!completedJob) return;

        const result = completedJob.result as {
          material: Material;
          inputGrade: "C";
          targetGrade: "B";
          inputKg: number;
          outputKg: number;
          residueKg: number;
          costCents: number;
          co2Kg: number;
        };
        if (
          !result ||
          result.material !== completedJob.materialType ||
          result.inputGrade !== "C" ||
          result.targetGrade !== "B" ||
          !Number.isInteger(result.outputKg) ||
          result.outputKg <= 0
        )
          throw new Error(`Quality upgrade ${completedJob._id} has an invalid result`);

        const team = await GameTeamState.findOne({
          gameId: completedJob.gameId,
          teamId: completedJob.teamId,
        }).session(session);
        if (!team)
          throw new Error(`Quality upgrade ${completedJob._id} has no team state`);
        if (!team.roleInventories?.mrf) {
          const defaults = emptyRoleInventories();
          team.roleInventories = { ...defaults, ...(team.roleInventories ?? {}) };
        }
        addMaterial(team.inventory, result.material, "B", result.outputKg);
        addMaterial(
          team.roleInventories.mrf,
          result.material,
          "B",
          result.outputKg,
        );
        team.markModified("roleInventories");
        team.revision += 1;
        await team.save({ session });

        await ActivityEvent.create(
          [
            {
              gameId: completedJob.gameId,
              teamId: completedJob.teamId,
              type: "mrf.quality_upgrade_completed",
              commandId: completedJob.commandId,
              actorType: "system",
              occurredAt: current,
              visibility: "facilitator",
              payload: {
                qualityUpgradeId: String(completedJob._id),
                result,
              },
            },
          ],
          { session },
        );
        await due(
          completedJob.gameId,
          "mrf.quality-upgrade.updated",
          {
            qualityUpgradeId: String(completedJob._id),
            materialType: result.material,
            inputGrade: result.inputGrade,
            targetGrade: result.targetGrade,
            status: "completed",
            result,
            completedAt: current,
            teamRevision: team.revision,
          },
          `team:${completedJob.gameId}:${completedJob.teamId}`,
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }
  for (const held of await WasteSource.find({
    status: "held",
    holdExpiresAt: { $lte: current },
  })) {
    await WasteSource.updateOne(
      { _id: held._id, status: "held" },
      { $set: { status: "processing" } },
    );
    await ProcessJob.create({
      gameId: held.gameId,
      teamId: held.teamId,
      wasteSourceId: String(held._id),
      methodId: "landfill",
      result: calculateProcessing(held as any, "landfill"),
      dueAt: current + 4000,
    });
    await activity(held.gameId, held.teamId, "mrf.hold_auto_landfill", {
      wasteSourceId: String(held._id),
    });
  }
  for (const mission of await HealthMission.find({
    status: "active",
    expiresAt: { $lte: current },
  })) {
    const template = HEALTH_MISSIONS.find(
      (item) => item.id === mission.templateId,
    );
    const answers = {
      municipality:
        mission.steps?.municipality?.optionKey ?? "no-response-timeout",
      mrf: mission.steps?.mrf?.optionKey ?? "no-response-timeout",
      broker: mission.steps?.broker?.optionKey ?? "no-response-timeout",
    } as any;
    const timeoutOutcome = template
      ? healthMissionDelta(template, answers)
      : { delta: -2, appropriateCount: 0, highImpact: false };
    const changed = await HealthMission.updateOne(
      { _id: mission._id, status: "active" },
      {
        $set: {
          status: "expired",
          completedAt: current,
          healthDelta: timeoutOutcome.delta,
        },
      },
    );
    if (!changed.modifiedCount) continue;
    const team = await GameTeamState.findOne({
      gameId: mission.gameId,
      teamId: mission.teamId,
    });
    if (team) {
      const healthChange = applyTeamHealthDelta(
        team as TeamState,
        timeoutOutcome.delta,
        current,
      );
      Object.assign(team, healthChange);
      team.revision += 1;
      await team.save();
    }
    await due(
      mission.gameId,
      "health-mission.updated",
      {
        missionId: String(mission._id),
        status: "expired",
        reason: "timeout",
        healthDelta: timeoutOutcome.delta,
        healthRecoveryUntil: team?.healthRecoveryUntil ?? null,
      },
      `team:${mission.gameId}:${mission.teamId}`,
    );
  }
  for (const offer of await TradeOffer.find({
    status: "open",
    expiresAt: { $lte: current },
  })) {
    const changed = await TradeOffer.updateOne(
      { _id: offer._id, status: "open" },
      { $set: { status: "expired" } },
    );
    if (!changed.modifiedCount) continue;
    const release: Record<string, number> = {
      lockedCashCents: -(offer.terms.offered.cashCents ?? 0),
    };
    for (const line of offer.terms.offered.materials)
      {
        release[`inventory.${line.materialType}.lockedKg`] =
          (release[`inventory.${line.materialType}.lockedKg`] ?? 0) -
          line.quantityKg;
        const gradeKey = `inventory.${line.materialType}.locked${line.grade}`;
        release[gradeKey] = (release[gradeKey] ?? 0) - line.quantityKg;
        release[`roleInventories.broker.${line.materialType}.lockedKg`] =
          (release[`roleInventories.broker.${line.materialType}.lockedKg`] ?? 0) -
          line.quantityKg;
        const roleGradeKey = `roleInventories.broker.${line.materialType}.locked${line.grade}`;
        release[roleGradeKey] = (release[roleGradeKey] ?? 0) - line.quantityKg;
      }
    await GameTeamState.updateOne(
      { gameId: offer.gameId, teamId: offer.offeringTeamId },
      { $inc: release },
    );
    const expiredUpdate = {
      offer: { ...offer.toObject(), status: "expired" },
      offerId: String(offer._id),
      status: "expired",
    };
    await due(
      offer.gameId,
      "trade.offer.updated",
      expiredUpdate,
      `team:${offer.gameId}:${offer.offeringTeamId}`,
    );
    await due(
      offer.gameId,
      "trade.offer.updated",
      expiredUpdate,
      `team:${offer.gameId}:${offer.recipientTeamId}`,
    );
  }
  for (const offer of await TradeOffer.find({
    status: "in-transit",
    deliveryDueAt: { $lte: current },
  })) {
    const changed = await TradeOffer.updateOne(
      { _id: offer._id, status: "in-transit" },
      { $set: { status: "completed" } },
    );
    if (!changed.modifiedCount) continue;
    for (const line of offer.terms.offered.materials)
      await GameTeamState.updateOne(
        { gameId: offer.gameId, teamId: offer.recipientTeamId },
        {
          $inc: {
            [`inventory.${line.materialType}.${line.grade}`]: line.quantityKg,
            [`roleInventories.broker.${line.materialType}.${line.grade}`]:
              line.quantityKg,
            "provenance.tradedKg": line.quantityKg,
            "metrics.tradedKg": line.quantityKg,
            revision: 1,
          },
        },
      );
    const requestedMaterialTransfers =
      offer.settlement?.requestedMaterialTransfers ??
      offer.terms.requested.materials.map((line: any) => ({
        materialType: line.materialType,
        grade: line.grade,
        quantityKg: line.quantityKg,
      }));
    for (const line of requestedMaterialTransfers)
      await GameTeamState.updateOne(
        { gameId: offer.gameId, teamId: offer.offeringTeamId },
        {
          $inc: {
            [`inventory.${line.materialType}.${line.grade}`]: line.quantityKg,
            [`roleInventories.broker.${line.materialType}.${line.grade}`]:
              line.quantityKg,
            "provenance.tradedKg": line.quantityKg,
            "metrics.tradedKg": line.quantityKg,
            revision: 1,
          },
        },
      );
    const deliveryUpdate = {
      offer: { ...offer.toObject(), status: "completed" },
      offerId: String(offer._id),
      status: "completed",
    };
    await due(
      offer.gameId,
      "trade.delivery.updated",
      deliveryUpdate,
      `team:${offer.gameId}:${offer.offeringTeamId}`,
    );
    await due(
      offer.gameId,
      "trade.delivery.updated",
      deliveryUpdate,
      `team:${offer.gameId}:${offer.recipientTeamId}`,
    );
  }
}
async function publishOutbox(): Promise<void> {
  const walletChangingEvents = new Set([
    "mrf.processing.updated",
    "team.inventory.updated",
    "material.transfer.updated",
    "project.claimed",
    "trade.offer.updated",
  ]);
  const events = await OutboxEvent.find({
    publishedAt: { $exists: false },
    $or: [
      { leaseUntil: { $exists: false } },
      { leaseUntil: { $lte: now() } },
    ],
  })
    .sort({ createdAtMs: 1 })
    .limit(100);
  for (const event of events) {
    const claimed = await OutboxEvent.updateOne(
      {
        _id: event._id,
        publishedAt: { $exists: false },
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: now() } },
        ],
      },
      {
        $set: { leaseUntil: now() + 10_000, leaseOwner: instanceId },
        $inc: { attempts: 1 },
      },
    );
    if (!claimed.modifiedCount) continue;
    emitter.to(event.target).emit(event.eventType, {
      eventId: String(event._id),
      eventType: event.eventType,
      gameId: event.gameId,
      occurredAt: event.createdAtMs,
      gameRevision: event.gameRevision ?? 0,
      payload: event.payload,
    });
    // Team and trade events are private, but wallet changes affect every city's rank.
    if (
      walletChangingEvents.has(event.eventType) &&
      event.target !== `game:${event.gameId}`
    )
      emitter.to(`game:${event.gameId}`).emit("leaderboard.updated", {
        eventId: String(event._id),
        eventType: "leaderboard.updated",
        gameId: event.gameId,
        occurredAt: event.createdAtMs,
        gameRevision: event.gameRevision ?? 0,
        payload: { sourceEventType: event.eventType },
      });
    await OutboxEvent.updateOne(
      { _id: event._id, leaseOwner: instanceId },
      {
        $set: { publishedAt: now() },
        $unset: { leaseUntil: 1, leaseOwner: 1 },
      },
    );
  }
}
async function tick(): Promise<void> {
  const games = await Game.find({
    status: { $in: ["scheduled", "briefing", "active", "finalizing"] },
    $or: [
      { schedulerLeaseUntil: { $exists: false } },
      { schedulerLeaseUntil: { $lte: now() } },
    ],
  }).limit(20);
  for (const game of games) {
    const lease = await Game.updateOne(
      {
        _id: game._id,
        $or: [
          { schedulerLeaseUntil: { $exists: false } },
          { schedulerLeaseUntil: { $lte: now() } },
        ],
      },
      {
        $set: {
          schedulerLeaseUntil: now() + 5000,
          schedulerLeaseOwner: instanceId,
        },
      },
    );
    if (!lease.modifiedCount) continue;
    try {
      await advanceGame(game);
    } finally {
      await Game.updateOne(
        { _id: game._id, schedulerLeaseOwner: instanceId },
        {
          $set: { schedulerLeaseUntil: now() - 1 },
          $unset: { schedulerLeaseOwner: 1 },
        },
      );
    }
  }
  await settleDueEntities();
  await publishOutbox();
}
let tickRunning = false;
let tickQueued = false;
async function runTick(): Promise<void> {
  if (tickRunning) {
    tickQueued = true;
    return;
  }
  tickRunning = true;
  try {
    do {
      tickQueued = false;
      await tick();
    } while (tickQueued);
  } catch (error) {
    console.error("worker tick failed", error);
  } finally {
    tickRunning = false;
  }
}
await connectMongo(env);
console.log("Clash of the Cities- Mission Net Zero scheduler worker started");
setInterval(() => void runTick(), 1000);
await runTick();
