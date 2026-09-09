import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Emitter } from "@socket.io/redis-emitter";
import Redis from "ioredis";
import {
  HEALTH_MISSIONS,
  STANDARD_SCENARIO,
} from "@circular-city/game-content";
import {
  addMaterial,
  calculateRankings,
  calculateProcessing,
  healthStatus,
  materialKeys,
  type TeamState,
} from "@circular-city/game-engine";
import { dueScheduleSlots, projectForSequence } from "./scheduler.js";
import { readEnv } from "../../api/src/env.js";
import { connectMongo } from "../../api/src/database.js";
import {
  ActivityEvent,
  Game,
  GameResultTeam,
  GameProject,
  GameTeamState,
  HealthMission,
  OutboxEvent,
  ProcessJob,
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
const due = async (
  gameId: string,
  type: string,
  payload: Record<string, unknown>,
  target = `game:${gameId}`,
): Promise<void> => {
  const game = await Game.findByIdAndUpdate(
    gameId,
    { $inc: { globalRevision: 1 } },
    { new: true },
  ).lean();
  await OutboxEvent.create({
    gameId,
    eventType: type,
    target,
    payload,
    gameRevision: game?.globalRevision ?? 0,
    createdAtMs: now(),
  });
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

async function spawnWaste(game: any, tickIndex: number): Promise<void> {
  const states = await GameTeamState.find({
    gameId: String(game._id),
    status: { $ne: "withdrawn" },
  }).lean();
  for (const state of states) {
    const visible = await WasteSource.countDocuments({
      gameId: String(game._id),
      teamId: state.teamId,
      status: "available",
    });
    if (visible >= STANDARD_SCENARIO.wasteVisibleCap) continue;
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
        seeded(game.seed, state.citySlot * 101 + tickIndex) %
          templates.length
      ]!;
    const mass =
      sourceTemplate.mass[0] +
      (seeded(game.seed, state.citySlot * 211 + tickIndex) %
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
  let lastWasteTick = game.lastWasteTick ?? -1;
  for (const wasteTick of dueScheduleSlots(
    lastWasteTick,
    activeElapsed,
    0,
    STANDARD_SCENARIO.wasteRefreshMs,
  )) {
    await spawnWaste(game, wasteTick);
    lastWasteTick = wasteTick;
  }
  if (game.lastWasteTick !== lastWasteTick) {
    game.lastWasteTick = lastWasteTick;
    await game.save();
  }

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
        const template =
          HEALTH_MISSIONS[
            seeded(game.seed, state.citySlot * 31 + missionSlot) %
              HEALTH_MISSIONS.length
          ]!;
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
  for (const transport of await Transport.find({
    status: "in_transit",
    arrivesAt: { $lte: current },
  })) {
    const changed = await Transport.updateOne(
      { _id: transport._id, status: "in_transit" },
      { $set: { status: "arrived" } },
    );
    if (!changed.modifiedCount) continue;
    await WasteSource.updateOne(
      { _id: transport.wasteSourceId, status: "in_transit" },
      {
        $set: { status: "at_mrf", queueArrivedAt: current },
        $unset: { transitArrivesAt: 1 },
      },
    );
    await due(
      transport.gameId,
      "municipality.transport.updated",
      { wasteSourceId: transport.wasteSourceId, status: "at_mrf" },
      `team:${transport.gameId}:${transport.teamId}`,
    );
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
      team.health = Math.max(0, team.health - 4);
      team.status = healthStatus(team.health);
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
      { healthDelta: -4, reason: "waste-expired" },
      `team:${source.gameId}:${source.teamId}`,
    );
  }
  for (const job of await ProcessJob.find({
    status: "processing",
    dueAt: { $lte: current },
  })) {
    const changed = await ProcessJob.updateOne(
      { _id: job._id, status: "processing" },
      { $set: { status: "completed" } },
    );
    if (!changed.modifiedCount) continue;
    const source = await WasteSource.findById(job.wasteSourceId).lean();
    const team = await GameTeamState.findOne({
      gameId: job.gameId,
      teamId: job.teamId,
    });
    if (!source || !team) continue;
    const result = calculateProcessing(source as any, job.mode as any);
    if (job.mode !== "landfill")
      for (const material of materialKeys)
        addMaterial(
          team.inventory,
          material,
          result.grade,
          result.outputKg[material],
        );
    team.walletCents -= result.residueCostCents;
    team.reservedCashCents = Math.max(
      0,
      (team.reservedCashCents ?? 0) - result.residueCostCents,
    );
    team.totalCO2Kg += result.residueCO2Kg;
    team.health = Math.max(0, team.health + result.healthDelta);
    team.status = healthStatus(team.health);
    team.metrics.recoveredKg += materialKeys.reduce(
      (sum, material) => sum + result.outputKg[material],
      0,
    );
    team.metrics.landfilledKg += result.residueKg;
    team.provenance.recoveredKg += materialKeys.reduce(
      (sum, material) => sum + result.outputKg[material],
      0,
    );
    team.revision += 1;
    await team.save();
    await WasteSource.updateOne(
      { _id: source._id },
      {
        $set: { status: job.mode === "landfill" ? "landfilled" : "processed" },
      },
    );
    await due(
      job.gameId,
      "mrf.processing.updated",
      { wasteSourceId: String(source._id), status: "completed", result },
      `team:${job.gameId}:${job.teamId}`,
    );
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
      mode: "landfill",
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
    const changed = await HealthMission.updateOne(
      { _id: mission._id, status: "active" },
      { $set: { status: "expired", healthDelta: -6 } },
    );
    if (!changed.modifiedCount) continue;
    const team = await GameTeamState.findOne({
      gameId: mission.gameId,
      teamId: mission.teamId,
    });
    if (team) {
      team.health = Math.max(0, team.health - 6);
      team.status = healthStatus(team.health);
      team.revision += 1;
      await team.save();
    }
    await due(
      mission.gameId,
      "health-mission.updated",
      { missionId: String(mission._id), status: "expired", healthDelta: -6 },
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
      }
    await GameTeamState.updateOne(
      { gameId: offer.gameId, teamId: offer.offeringTeamId },
      { $inc: release },
    );
    await due(
      offer.gameId,
      "trade.offer.updated",
      { offerId: String(offer._id), status: "expired" },
      `trade:${offer.gameId}:${String(offer._id)}`,
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
        grade: "B",
        quantityKg: line.quantityKg,
      }));
    for (const line of requestedMaterialTransfers)
      await GameTeamState.updateOne(
        { gameId: offer.gameId, teamId: offer.offeringTeamId },
        {
          $inc: {
            [`inventory.${line.materialType}.${line.grade}`]: line.quantityKg,
            "provenance.tradedKg": line.quantityKg,
            "metrics.tradedKg": line.quantityKg,
            revision: 1,
          },
        },
      );
    await due(
      offer.gameId,
      "trade.delivery.updated",
      { offerId: String(offer._id), status: "completed" },
      `trade:${offer.gameId}:${String(offer._id)}`,
    );
  }
}
async function publishOutbox(): Promise<void> {
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
await connectMongo(env);
console.log("Circular City scheduler worker started");
setInterval(
  () =>
    void tick().catch((error) => console.error("worker tick failed", error)),
  1000,
);
await tick();
