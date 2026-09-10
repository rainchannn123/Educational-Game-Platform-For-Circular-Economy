import { createHash } from "node:crypto";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import type { Material, MaterialMap, Role } from "@circular-city/contracts";
import {
  HEALTH_MISSIONS,
  MATERIALS,
  STANDARD_SCENARIO,
} from "@circular-city/game-content";
import {
  applyProjectClaim,
  assertTradeLockable,
  availableEligibleKg,
  calculateCollection,
  calculateProcessing,
  healthMissionDelta,
  healthStatus,
  materialKeys,
  roundHalfUp,
  RuleError,
  sameMaterialMap,
  validateTradeTerms,
  type TeamState,
  type TradeTerms,
} from "@circular-city/game-engine";
import {
  ActivityEvent,
  Game,
  GameProject,
  GameTeamState,
  HealthMission,
  Idempotency,
  OutboxEvent,
  ProcessJob,
  ProjectWork,
  Team,
  TradeOffer,
  Transport,
  WasteSource,
} from "./models.js";

export type CommandResult = {
  commandId: string;
  teamRevision?: number;
  serverTime: number;
  result: Record<string, unknown>;
};
const now = (): number => Date.now();
const plain = <T>(value: T): T => structuredClone(value);

export class GameService {
  private spendableWallet(state: Record<string, any>): number {
    return (
      state.walletCents -
      (state.lockedCashCents ?? 0) -
      (state.reservedCashCents ?? 0)
    );
  }
  private walletCanCover(costCents: number): Record<string, unknown> {
    return {
      $expr: {
        $gte: [
          {
            $subtract: [
              {
                $subtract: [
                  "$walletCents",
                  { $ifNull: ["$lockedCashCents", 0] },
                ],
              },
              { $ifNull: ["$reservedCashCents", 0] },
            ],
          },
          costCents,
        ],
      },
    };
  }
  private assertProjectPlan(
    work: Record<string, any>,
    project: Record<string, any>,
  ): void {
    if (
      !work.plannedMaterialsKg ||
      !sameMaterialMap(work.plannedMaterialsKg, project.template.requirementsKg)
    )
      throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
  }
  private assertReadinessSelection(
    state: Record<string, any>,
    work: Record<string, any>,
    project: Record<string, any>,
    role: Role,
    value: string,
  ): void {
    this.assertProjectPlan(work, project);
    if (role === "municipality") return;

    const requirements = work.plannedMaterialsKg as MaterialMap;
    if (role === "mrf") {
      const canCertify = materialKeys.every((material) =>
        value === "grade-a-bundle"
          ? state.inventory[material].A >= requirements[material]
          : availableEligibleKg(state.inventory, material) >=
            requirements[material],
      );
      if (!canCertify) throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
      return;
    }

    const plannedKg = materialKeys.reduce(
      (sum, material) => sum + requirements[material],
      0,
    );
    const provenance = state.provenance ?? {};
    const requiredKg =
      value === "recovered-first" ? Math.ceil(plannedKg * 0.6) : Math.ceil(plannedKg * 0.1);
    const actualKg =
      value === "recovered-first"
        ? provenance.recoveredKg ?? 0
        : value === "trade-supported"
          ? provenance.tradedKg ?? 0
          : provenance.externalKg ?? 0;
    if (actualKg < requiredKg)
      throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
  }
  private assertProjectReadiness(
    state: Record<string, any>,
    work: Record<string, any>,
    project: Record<string, any>,
  ): void {
    if (!work.municipalityReady || !work.mrfReady || !work.brokerReady)
      throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
    this.assertReadinessSelection(
      state,
      work,
      project,
      "mrf",
      work.certification,
    );
    this.assertReadinessSelection(
      state,
      work,
      project,
      "broker",
      work.procurementPlan,
    );
  }
  private async assertTradeMaterialsAvailable(
    gameId: string,
    teamId: string,
    state: Record<string, any>,
    terms: TradeTerms,
    session?: ClientSession,
  ): Promise<void> {
    const openOffers = await TradeOffer.find({
      gameId,
      offeringTeamId: teamId,
      status: "open",
    })
      .session(session ?? null)
      .lean();
    const locked = new Map<string, number>();
    for (const offer of openOffers)
      for (const line of (offer.terms as TradeTerms).offered.materials) {
        const key = `${line.materialType}:${line.grade}`;
        locked.set(key, (locked.get(key) ?? 0) + line.quantityKg);
      }
    for (const line of terms.offered.materials) {
      const key = `${line.materialType}:${line.grade}`;
      const available =
        state.inventory[line.materialType][line.grade] - (locked.get(key) ?? 0);
      if (available < line.quantityKg)
        throw new RuleError("MATERIAL_LOCKED_FOR_TRADE");
    }
  }
  async member(
    gameId: string,
    userId: string,
  ): Promise<{
    team: Record<string, any>;
    state: Record<string, any>;
    role: Role;
  }> {
    const game = await Game.findById(gameId).lean();
    if (!game) throw new RuleError("GAME_NOT_FOUND");
    const team = await Team.findOne({
      _id: { $in: game.participantTeamIds },
      "members.userId": userId,
    }).lean();
    if (!team) throw new RuleError("TEAM_MEMBERSHIP_REQUIRED");
    const member = team.members.find(
      (item: { userId: string }) => item.userId === userId,
    );
    if (!member?.role) throw new RuleError("ROLE_NOT_SELECTED");
    const state = await GameTeamState.findOne({
      gameId,
      teamId: String(team._id),
    }).lean();
    if (!state) throw new RuleError("TEAM_STATE_NOT_FOUND");
    return { team, state, role: member.role as Role };
  }
  private assertRole(actual: Role, expected: Role): void {
    if (actual !== expected) throw new RuleError("ROLE_NOT_AUTHORIZED");
  }
  private assertStatus(status: string, allowed: string[]): void {
    if (!allowed.includes(status))
      throw new RuleError(
        status === "paused" ? "GAME_PAUSED" : "GAME_NOT_ACCEPTING_ACTIONS",
      );
  }
  private async audit(
    gameId: string,
    teamId: string | undefined,
    type: string,
    commandId: string | undefined,
    actor: { userId?: string; role?: string; actorType: string },
    payload: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<void> {
    await ActivityEvent.create(
      [
        {
          gameId,
          teamId,
          type,
          commandId,
          occurredAt: now(),
          actorType: actor.actorType,
          actorUserId: actor.userId,
          actorRole: actor.role,
          visibility: "facilitator",
          payload,
        },
      ],
      { session },
    );
  }
  private async outbox(
    gameId: string,
    eventType: string,
    target: string,
    payload: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<void> {
    const game = await Game.findById(gameId)
      .session(session ?? null)
      .lean();
    await OutboxEvent.create(
      [
        {
          gameId,
          eventType,
          target,
          payload,
          gameRevision: (game?.globalRevision ?? 0) + 1,
          createdAtMs: now(),
        },
      ],
      { session },
    );
    if (game)
      await Game.updateOne(
        { _id: gameId },
        { $inc: { globalRevision: 1 } },
        { session },
      );
  }
  async idempotent<T>(
    key: string,
    userId: string,
    method: string,
    path: string,
    body: unknown,
    action: () => Promise<T>,
  ): Promise<T> {
    // Commands must not race while Mongo is still building the unique key index.
    await Idempotency.init();
    const bodyHash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    const validatePrior = (prior: Record<string, any>): void => {
      if (
        prior.userId !== userId ||
        prior.method !== method ||
        prior.path !== path ||
        prior.bodyHash !== bodyHash
      )
        throw new RuleError("IDEMPOTENCY_KEY_REUSED");
    };
    const prior = await Idempotency.findOne({ key }).lean();
    let ownsReservation = false;
    if (prior) {
      validatePrior(prior);
      if (prior.status !== "processing") return prior.response as T;
    } else {
      try {
        await Idempotency.create({
          key,
          userId,
          method,
          path,
          bodyHash,
          status: "processing",
        });
        ownsReservation = true;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const reservation = await Idempotency.findOne({ key }).lean();
      if (!reservation) break;
      validatePrior(reservation);
      if (reservation.status !== "processing") return reservation.response as T;
      if (ownsReservation) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }

    const reservation = await Idempotency.findOne({ key }).lean();
    if (!reservation) throw new RuleError("COMMAND_IN_PROGRESS");
    validatePrior(reservation);
    if (reservation.status !== "processing") return reservation.response as T;
    if (!ownsReservation) throw new RuleError("COMMAND_IN_PROGRESS");

    try {
      const response = await action();
      await Idempotency.updateOne(
        { key, status: "processing" },
        { $set: { response, statusCode: 200, status: "completed" } },
      );
      return response;
    } catch (error) {
      await Idempotency.deleteOne({ key, status: "processing" });
      throw error;
    }
  }
  async dispatchCollection(
    gameId: string,
    userId: string,
    commandId: string,
    expectedRevision: number,
    wasteSourceId: string,
    route: "express" | "standard" | "consolidated",
  ): Promise<CommandResult> {
    const { state, role } = await this.member(gameId, userId);
    this.assertRole(role, "municipality");
    const game = await Game.findById(gameId).lean();
    this.assertStatus(game?.status ?? "", ["active"]);
    if (state.revision !== expectedRevision)
      throw new RuleError("STALE_TEAM_REVISION");
    const source = await WasteSource.findOne({
      _id: wasteSourceId,
      gameId,
      teamId: state.teamId,
    }).lean();
    if (!source) throw new RuleError("WASTE_SOURCE_NOT_FOUND");
    if (source.status !== "available")
      throw new RuleError("WASTE_SOURCE_NOT_AVAILABLE");
    if (source.expiresAt <= now()) throw new RuleError("WASTE_SOURCE_EXPIRED");
    const queueCount = await WasteSource.countDocuments({
      gameId,
      teamId: state.teamId,
      status: { $in: ["in_transit", "at_mrf", "held", "processing"] },
    });
    if (queueCount >= 3) throw new RuleError("MRF_QUEUE_FULL");
    const quote = calculateCollection(source as any, route);
    const arrivesAt = now() + quote.durationMs;
    if (this.spendableWallet(state) < quote.costCents)
      throw new RuleError("INSUFFICIENT_WALLET");
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const changed = await GameTeamState.updateOne(
          {
            _id: state._id,
            revision: expectedRevision,
            ...this.walletCanCover(quote.costCents),
          },
          {
            $inc: {
              walletCents: -quote.costCents,
              totalCO2Kg: quote.co2Kg,
              revision: 1,
              "metrics.collectedKg": source.massKg,
            },
          },
          { session },
        );
        if (!changed.modifiedCount) throw new RuleError("STALE_TEAM_REVISION");
        const sourceChanged = await WasteSource.updateOne(
          { _id: wasteSourceId, status: "available" },
          {
            $set: {
              status: "in_transit",
              transitArrivesAt: arrivesAt,
            },
          },
          { session },
        );
        if (!sourceChanged.modifiedCount)
          throw new RuleError("WASTE_SOURCE_NOT_AVAILABLE");
        await Transport.create(
          [
            {
              gameId,
              teamId: state.teamId,
              wasteSourceId,
              route,
              arrivesAt,
            },
          ],
          { session },
        );
        await this.audit(
          gameId,
          state.teamId,
          "municipality.collection_dispatched",
          commandId,
          { userId, role, actorType: "player" },
          {
            wasteSourceId,
            route,
            walletDeltaCents: -quote.costCents,
            co2DeltaKg: quote.co2Kg,
          },
          session,
        );
        await this.outbox(
          gameId,
          "municipality.transport.updated",
          `team:${gameId}:${state.teamId}`,
          {
            wasteSourceId,
            status: "in_transit",
            arrivesAt,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    return {
      commandId,
      teamRevision: expectedRevision + 1,
      serverTime: now(),
      result: { wasteSourceId, route, arrivesInMs: quote.durationMs },
    };
  }
  async startProcess(
    gameId: string,
    userId: string,
    commandId: string,
    expectedRevision: number,
    wasteSourceId: string,
    mode: "rapid" | "balanced" | "quality" | "hold" | "landfill",
  ): Promise<CommandResult> {
    const { state, role } = await this.member(gameId, userId);
    this.assertRole(role, "mrf");
    const game = await Game.findById(gameId).lean();
    this.assertStatus(game?.status ?? "", ["active"]);
    if (state.revision !== expectedRevision)
      throw new RuleError("STALE_TEAM_REVISION");
    const source = await WasteSource.findOne({
      _id: wasteSourceId,
      gameId,
      teamId: state.teamId,
    }).lean();
    if (!source || !["at_mrf", "held"].includes(source.status))
      throw new RuleError("WASTE_SOURCE_NOT_AVAILABLE");
    if (
      mode !== "hold" &&
      (await ProcessJob.exists({
        gameId,
        teamId: state.teamId,
        status: "processing",
      }))
    )
      throw new RuleError("MRF_ALREADY_PROCESSING");
    if (mode === "hold") {
      const holdExpiresAt = Math.min(
        (source.queueArrivedAt ?? now()) + 45_000,
        now() + 30_000,
      );
      await WasteSource.updateOne(
        { _id: source._id, status: { $in: ["at_mrf", "held"] } },
        { $set: { status: "held", holdExpiresAt } },
      );
      await this.outbox(
        gameId,
        "mrf.queue.updated",
        `team:${gameId}:${state.teamId}`,
        { wasteSourceId, status: "held", holdExpiresAt },
      );
      return {
        commandId,
        teamRevision: state.revision,
        serverTime: now(),
        result: { status: "held", holdExpiresAt },
      };
    }
    const calculation = calculateProcessing(source as any, mode);
    const totalCommittedCost =
      calculation.processingCostCents + calculation.residueCostCents;
    if (this.spendableWallet(state) < totalCommittedCost)
      throw new RuleError("INSUFFICIENT_WALLET");
    const duration =
      mode === "rapid"
        ? 6000
        : mode === "balanced"
          ? 10000
          : mode === "quality"
            ? 14000
            : 4000;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await GameTeamState.updateOne(
          {
            _id: state._id,
            revision: expectedRevision,
            ...this.walletCanCover(totalCommittedCost),
          },
          {
            $inc: {
              walletCents: -calculation.processingCostCents,
              reservedCashCents: calculation.residueCostCents,
              totalCO2Kg: calculation.processingCO2Kg,
              revision: 1,
            },
          },
          { session },
        );
        if (!updated.modifiedCount) throw new RuleError("STALE_TEAM_REVISION");
        const sourceChanged = await WasteSource.updateOne(
          { _id: source._id, status: { $in: ["at_mrf", "held"] } },
          { $set: { status: "processing" } },
          { session },
        );
        if (!sourceChanged.modifiedCount)
          throw new RuleError("WASTE_SOURCE_NOT_AVAILABLE");
        await ProcessJob.create(
          [
            {
              gameId,
              teamId: state.teamId,
              wasteSourceId,
              mode,
              dueAt: now() + duration,
            },
          ],
          { session },
        );
        await this.audit(
          gameId,
          state.teamId,
          "mrf.processing_started",
          commandId,
          { userId, role, actorType: "player" },
          { wasteSourceId, mode },
          session,
        );
        await this.outbox(
          gameId,
          "mrf.processing.updated",
          `team:${gameId}:${state.teamId}`,
          { wasteSourceId, mode, dueAt: now() + duration },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    return {
      commandId,
      teamRevision: expectedRevision + 1,
      serverTime: now(),
      result: { wasteSourceId, mode, dueAt: now() + duration },
    };
  }
  async externalPurchase(
    gameId: string,
    userId: string,
    commandId: string,
    expectedRevision: number,
    material: Material,
    quantityKg: number,
  ): Promise<CommandResult> {
    const { state, role } = await this.member(gameId, userId);
    this.assertRole(role, "broker");
    const game = await Game.findById(gameId).lean();
    this.assertStatus(game?.status ?? "", ["active"]);
    if (state.revision !== expectedRevision)
      throw new RuleError("STALE_TEAM_REVISION");
    if (quantityKg % 100 || quantityKg < 100 || quantityKg > 10_000)
      throw new RuleError("INVALID_QUANTITY");
    const costCents = quantityKg * MATERIALS[material].externalPriceCentsPerKg;
    const co2Kg = roundHalfUp(
      quantityKg * MATERIALS[material].externalCO2MilliKgPerKg,
      1000,
    );
    if (this.spendableWallet(state) < costCents)
      throw new RuleError("INSUFFICIENT_WALLET");
    const result = await GameTeamState.findOneAndUpdate(
      {
        _id: state._id,
        revision: expectedRevision,
        ...this.walletCanCover(costCents),
      },
      {
        $inc: {
          walletCents: -costCents,
          totalCO2Kg: co2Kg,
          [`inventory.${material}.B`]: quantityKg,
          "provenance.externalKg": quantityKg,
          "metrics.externalPurchasedKg": quantityKg,
          revision: 1,
        },
      },
      { new: true },
    );
    if (!result) throw new RuleError("STALE_TEAM_REVISION");
    await this.audit(
      gameId,
      state.teamId,
      "broker.external_purchased",
      commandId,
      { userId, role, actorType: "player" },
      { material, quantityKg, costCents, co2Kg },
    );
    await this.outbox(
      gameId,
      "team.inventory.updated",
      `team:${gameId}:${state.teamId}`,
      {
        material,
        grade: "B",
        quantityKg,
        source: "external",
        revision: result.revision,
      },
    );
    return {
      commandId,
      teamRevision: result.revision,
      serverTime: now(),
      result: { material, quantityKg, costCents, co2Kg },
    };
  }
  async savePlan(
    gameId: string,
    userId: string,
    commandId: string,
    projectId: string,
    expectedWorkRevision: number,
    plannedMaterialsKg: MaterialMap,
  ): Promise<CommandResult> {
    const { state } = await this.member(gameId, userId);
    const project = await GameProject.findOne({
      _id: projectId,
      gameId,
    }).lean();
    if (!project || !["active", "queued"].includes(project.status))
      throw new RuleError("PROJECT_NOT_ACTIVE");
    if (!sameMaterialMap(plannedMaterialsKg, project.template.requirementsKg))
      throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
    const existing = await ProjectWork.findOne({
      projectId,
      teamId: state.teamId,
    }).lean();
    if (existing && existing.workRevision !== expectedWorkRevision)
      throw new RuleError("STALE_PROJECT_WORK_REVISION");
    const work = await ProjectWork.findOneAndUpdate(
      {
        projectId,
        teamId: state.teamId,
        ...(existing ? { workRevision: expectedWorkRevision } : {}),
      },
      {
        $set: { gameId, plannedMaterialsKg, status: "open" },
        $inc: { workRevision: 1 },
      },
      { new: true, upsert: true },
    );
    await this.outbox(
      gameId,
      "project.readiness.updated",
      `team:${gameId}:${state.teamId}`,
      { projectId, work },
    );
    return {
      commandId,
      serverTime: now(),
      result: { projectId, workRevision: work.workRevision },
    };
  }
  async setReadiness(
    gameId: string,
    userId: string,
    commandId: string,
    projectId: string,
    role: Role,
    value: string,
  ): Promise<CommandResult> {
    const membership = await this.member(gameId, userId);
    this.assertRole(membership.role, role);
    const project = await GameProject.findOne({
      _id: projectId,
      gameId,
      status: "active",
    }).lean();
    if (!project) throw new RuleError("PROJECT_NOT_ACTIVE");
    const work = await ProjectWork.findOne({
      projectId,
      teamId: membership.state.teamId,
    }).lean();
    if (!work?.plannedMaterialsKg)
      throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
    const valid =
      role === "municipality"
        ? ["standard-delivery", "low-carbon-delivery"]
        : role === "mrf"
          ? ["grade-a-bundle", "grade-b-bundle"]
          : ["recovered-first", "trade-supported", "external-supported"];
    if (!valid.includes(value))
      throw new RuleError("INVALID_READINESS_SELECTION");
    this.assertReadinessSelection(
      membership.state,
      work,
      project,
      role,
      value,
    );
    const field = `${role}Ready`;
    const valueField =
      role === "municipality"
        ? "sitePlan"
        : role === "mrf"
          ? "certification"
          : "procurementPlan";
    const changed = await ProjectWork.findOneAndUpdate(
      { _id: work._id, status: "open" },
      {
        $set: {
          [field]: true,
          [valueField]: value,
          [`${role}ReadyByUserId`]: userId,
          [`${role}ReadyAt`]: now(),
        },
        $inc: { workRevision: 1 },
      },
      { new: true },
    );
    if (!changed) throw new RuleError("READINESS_ALREADY_SET");
    await this.outbox(
      gameId,
      "project.readiness.updated",
      `team:${gameId}:${membership.state.teamId}`,
      { projectId, work: changed },
    );
    return {
      commandId,
      serverTime: now(),
      result: { projectId, role, ready: true },
    };
  }
  async claimProject(
    gameId: string,
    userId: string,
    commandId: string,
    projectId: string,
    expectedRevision: number,
  ): Promise<CommandResult> {
    const membership = await this.member(gameId, userId);
    const session = await mongoose.startSession();
    let result: CommandResult | undefined;
    try {
      await session.withTransaction(async () => {
        const game = await Game.findById(gameId).session(session).lean();
        this.assertStatus(game?.status ?? "", ["active", "finalizing"]);
        const project = await GameProject.findOneAndUpdate(
          {
            _id: projectId,
            gameId,
            status: "active",
            expiresAt: { $gte: now() },
          },
          { $set: { status: "claiming" } },
          { new: true, session },
        ).lean();
        if (!project) {
          const existing = await GameProject.findById(projectId)
            .session(session)
            .lean();
          throw new RuleError(
            existing?.status === "claimed"
              ? "PROJECT_ALREADY_CLAIMED"
              : "PROJECT_NOT_ACTIVE",
          );
        }
        const teamDoc = await GameTeamState.findById(membership.state._id)
          .session(session)
          .lean();
        if (!teamDoc || teamDoc.revision !== expectedRevision)
          throw new RuleError("STALE_TEAM_REVISION");
        const teams = await GameTeamState.find({ gameId })
          .session(session)
          .lean();
        const applied = applyProjectClaim(
          plain(teamDoc) as TeamState,
          teams.map((team) => plain(team) as TeamState),
          project.template,
          now(),
          project.expiresAt,
          expectedRevision,
        );
        await GameTeamState.replaceOne(
          { _id: teamDoc._id, revision: expectedRevision },
          { ...teamDoc, ...applied.team },
          { session },
        );
        await GameProject.updateOne(
          { _id: projectId, status: "claiming" },
          {
            $set: {
              status: "claimed",
              winnerTeamId: membership.state.teamId,
              claimedAt: now(),
              awardReceipt: applied.receipt,
            },
          },
          { session },
        );
        await ProjectWork.updateMany(
          { projectId },
          { $set: { status: "closed" } },
          { session },
        );
        await this.audit(
          gameId,
          membership.state.teamId,
          "project.claimed",
          commandId,
          { userId, role: membership.role, actorType: "player" },
          { projectId, receipt: applied.receipt },
          session,
        );
        await this.outbox(
          gameId,
          "project.claimed",
          `game:${gameId}`,
          {
            projectId,
            winnerTeamId: membership.state.teamId,
            grossRevenueCents: applied.receipt.grossRevenueCents,
            netRevenueCents: applied.receipt.netRevenueCents,
            multiplierBasisPoints: applied.receipt.multiplierBasisPoints,
            co2ImpactKg: project.template.co2ImpactKg,
          },
          session,
        );
        result = {
          commandId,
          teamRevision: applied.team.revision,
          serverTime: now(),
          result: { projectId, receipt: applied.receipt },
        };
      });
    } finally {
      await session.endSession();
    }
    return result!;
  }
  async createTrade(
    gameId: string,
    userId: string,
    commandId: string,
    expectedRevision: number,
    recipientTeamId: string,
    terms: TradeTerms,
  ): Promise<CommandResult> {
    const membership = await this.member(gameId, userId);
    this.assertRole(membership.role, "broker");
    if (recipientTeamId === membership.state.teamId)
      throw new RuleError("TRADE_SAME_TEAM");
    validateTradeTerms(terms);
    const session = await mongoose.startSession();
    let offer: any;
    try {
      await session.withTransaction(async () => {
        const game = await Game.findById(gameId).session(session).lean();
        this.assertStatus(game?.status ?? "", ["active"]);
        const state = await GameTeamState.findById(membership.state._id)
          .session(session)
          .lean();
        if (!state || state.revision !== expectedRevision)
          throw new RuleError("STALE_TEAM_REVISION");
        const recipient = await GameTeamState.findOne({
          gameId,
          teamId: recipientTeamId,
          status: { $ne: "withdrawn" },
        }).session(session);
        if (!recipient) throw new RuleError("TRADE_RECIPIENT_NOT_FOUND");
        if (
          (await TradeOffer.countDocuments({
            gameId,
            offeringTeamId: state.teamId,
            status: "open",
          }).session(session)) >= 2 ||
          (await TradeOffer.countDocuments({
            gameId,
            recipientTeamId,
            status: "open",
          }).session(session)) >= 2
        )
          throw new RuleError("TRADE_OFFER_LIMIT");
        assertTradeLockable(state as any, terms);
        await this.assertTradeMaterialsAvailable(
          gameId,
          state.teamId,
          state,
          terms,
          session,
        );
        const increments: Record<string, number> = {
          revision: 1,
          lockedCashCents: terms.offered.cashCents,
        };
        for (const item of terms.offered.materials)
          {
            increments[`inventory.${item.materialType}.lockedKg`] =
              (increments[`inventory.${item.materialType}.lockedKg`] ?? 0) +
              item.quantityKg;
            const gradeKey = `inventory.${item.materialType}.locked${item.grade}`;
            increments[gradeKey] = (increments[gradeKey] ?? 0) + item.quantityKg;
          }
        const update = await GameTeamState.updateOne(
          { _id: state._id, revision: expectedRevision },
          { $inc: increments },
          { session },
        );
        if (!update.modifiedCount) throw new RuleError("STALE_TEAM_REVISION");
        offer = (
          await TradeOffer.create(
            [
              {
                gameId,
                offeringTeamId: state.teamId,
                recipientTeamId,
                terms,
                expiresAt: now() + STANDARD_SCENARIO.tradeExpiryMs,
              },
            ],
            { session },
          )
        )[0];
        await this.audit(
          gameId,
          state.teamId,
          "trade.offer_created",
          commandId,
          { userId, role: "broker", actorType: "player" },
          { tradeOfferId: String(offer._id), recipientTeamId },
          session,
        );
        await this.outbox(
          gameId,
          "trade.offer.updated",
          `team:${gameId}:${state.teamId}`,
          { offer },
          session,
        );
        await this.outbox(
          gameId,
          "trade.offer.updated",
          `team:${gameId}:${recipientTeamId}`,
          { offer },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    return {
      commandId,
      teamRevision: expectedRevision + 1,
      serverTime: now(),
      result: { offer },
    };
  }
  async settleTrade(
    gameId: string,
    userId: string,
    commandId: string,
    offerId: string,
    action: "accept" | "reject" | "cancel",
  ): Promise<CommandResult> {
    const membership = await this.member(gameId, userId);
    this.assertRole(membership.role, "broker");
    const session = await mongoose.startSession();
    let response: CommandResult | undefined;
    try {
      await session.withTransaction(async () => {
        const game = await Game.findById(gameId).session(session).lean();
        this.assertStatus(game?.status ?? "", ["active"]);
        if (game?.activeEndsAt && game.activeEndsAt <= now())
          throw new RuleError("GAME_NOT_ACCEPTING_ACTIONS");
        const offer = await TradeOffer.findOne({
          _id: offerId,
          gameId,
          status: "open",
        })
          .session(session)
          .lean();
        if (!offer || offer.expiresAt <= now())
          throw new RuleError("TRADE_OFFER_EXPIRED");
        const creator = offer.offeringTeamId === membership.state.teamId;
        if (action === "cancel" && !creator)
          throw new RuleError("TRADE_NOT_CREATOR");
        if ((action === "accept" || action === "reject") && creator)
          throw new RuleError("TRADE_NOT_RECIPIENT");
        const offering = await GameTeamState.findOne({
          gameId,
          teamId: offer.offeringTeamId,
        })
          .session(session)
          .lean();
        const receiving = await GameTeamState.findOne({
          gameId,
          teamId: offer.recipientTeamId,
        })
          .session(session)
          .lean();
        if (!offering || !receiving)
          throw new RuleError("TEAM_STATE_NOT_FOUND");
        const terms = offer.terms as TradeTerms;
        const unlock: Record<string, number> = {
          lockedCashCents: -(terms.offered.cashCents ?? 0),
        };
        for (const line of terms.offered.materials)
          {
            unlock[`inventory.${line.materialType}.lockedKg`] =
              (unlock[`inventory.${line.materialType}.lockedKg`] ?? 0) -
              line.quantityKg;
            const gradeKey = `inventory.${line.materialType}.locked${line.grade}`;
            unlock[gradeKey] = (unlock[gradeKey] ?? 0) - line.quantityKg;
          }
        if (action !== "accept") {
          await GameTeamState.updateOne(
            { _id: offering._id },
            { $inc: unlock },
            { session },
          );
          await TradeOffer.updateOne(
            { _id: offerId, status: "open" },
            {
              $set: { status: action === "cancel" ? "cancelled" : "rejected" },
            },
            { session },
          );
          response = {
            commandId,
            serverTime: now(),
            result: {
              offerId,
              status: action === "cancel" ? "cancelled" : "rejected",
            },
          };
        } else {
          for (const line of terms.offered.materials)
            if (offering.inventory[line.materialType][line.grade] < line.quantityKg)
              throw new RuleError("MATERIAL_LOCKED_FOR_TRADE");

          const receivingLocks = new Map<string, number>();
          const receivingOpenOffers = await TradeOffer.find({
            gameId,
            offeringTeamId: receiving.teamId,
            status: "open",
          })
            .session(session)
            .lean();
          for (const otherOffer of receivingOpenOffers)
            for (const line of (otherOffer.terms as TradeTerms).offered.materials) {
              const key = `${line.materialType}:${line.grade}`;
              receivingLocks.set(
                key,
                (receivingLocks.get(key) ?? 0) + line.quantityKg,
              );
            }

          const requestedMaterialTransfers: Array<{
            materialType: Material;
            grade: "A" | "B" | "C";
            quantityKg: number;
          }> = [];
          const receivingInc: Record<string, number> = {};
          for (const line of terms.requested.materials) {
            let remaining = line.quantityKg;
            const grades =
              line.minimumGrade === "A"
                ? (["A"] as const)
                : line.minimumGrade === "B"
                  ? (["B", "A"] as const)
                  : (["C", "B", "A"] as const);
            for (const grade of grades) {
              const key = `${line.materialType}:${grade}`;
              const quantity = Math.min(
                Math.max(
                  0,
                  receiving.inventory[line.materialType][grade] -
                    (receivingLocks.get(key) ?? 0),
                ),
                remaining,
              );
              if (quantity <= 0) continue;
              receivingInc[`inventory.${line.materialType}.${grade}`] =
                (receivingInc[`inventory.${line.materialType}.${grade}`] ?? 0) -
                quantity;
              requestedMaterialTransfers.push({
                materialType: line.materialType,
                grade,
                quantityKg: quantity,
              });
              remaining -= quantity;
            }
            if (remaining > 0) throw new RuleError("PROJECT_REQUIREMENTS_NOT_MET");
          }

          const offeredCash = terms.offered.cashCents;
          const requestedCash = terms.requested.cashCents;
          if ((offering.lockedCashCents ?? 0) < offeredCash)
            throw new RuleError("TRADE_LOCK_INVALID");
          const offeringServiceFee = Math.floor((offeredCash * 5 + 50) / 100);
          const receivingServiceFee = Math.floor((requestedCash * 5 + 50) / 100);
          const logistics =
            terms.deliveryMode === "standard"
              ? { due: 8000, fee: 4000, co2: 350 }
              : { due: 15000, fee: 2500, co2: 150 };
          const offeringOtherLocks =
            (offering.lockedCashCents ?? 0) - offeredCash;
          const offeringSpendable =
            offering.walletCents -
            offeringOtherLocks -
            (offering.reservedCashCents ?? 0);
          const receivingSpendable = this.spendableWallet(receiving);
          if (
            offeringSpendable <
              offeredCash + offeringServiceFee + logistics.fee ||
            receivingSpendable <
              requestedCash + receivingServiceFee + logistics.fee
          )
            throw new RuleError("INSUFFICIENT_WALLET");

          const offeredInc: Record<string, number> = {
            ...unlock,
            walletCents:
              -offeredCash +
              requestedCash -
              offeringServiceFee -
              logistics.fee,
            totalCO2Kg: logistics.co2,
            revision: 1,
          };
          Object.assign(receivingInc, {
            walletCents:
              offeredCash -
              requestedCash -
              receivingServiceFee -
              logistics.fee,
            totalCO2Kg: logistics.co2,
            revision: 1,
          });
          for (const line of terms.offered.materials)
            offeredInc[`inventory.${line.materialType}.${line.grade}`] =
              (offeredInc[`inventory.${line.materialType}.${line.grade}`] ??
                0) - line.quantityKg;
          await GameTeamState.updateOne(
            { _id: offering._id },
            { $inc: offeredInc },
            { session },
          );
          await GameTeamState.updateOne(
            { _id: receiving._id },
            { $inc: receivingInc },
            { session },
          );
          const deliveryDueAt = now() + logistics.due;
          await TradeOffer.updateOne(
            { _id: offerId, status: "open" },
            {
              $set: {
                status: "in-transit",
                deliveryDueAt,
                settlement: {
                  serviceFeeCents: {
                    offering: offeringServiceFee,
                    receiving: receivingServiceFee,
                  },
                  logistics,
                  requestedMaterialTransfers,
                },
              },
            },
            { session },
          );
          response = {
            commandId,
            serverTime: now(),
            result: { offerId, status: "in-transit", deliveryDueAt },
          };
        }
        await this.audit(
          gameId,
          membership.state.teamId,
          `trade.${action}`,
          commandId,
          { userId, role: "broker", actorType: "player" },
          { offerId },
          session,
        );
        await this.outbox(
          gameId,
          "trade.offer.updated",
          `trade:${gameId}:${offerId}`,
          response!.result,
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    return response!;
  }
  async healthStep(
    gameId: string,
    userId: string,
    commandId: string,
    missionId: string,
    optionKey: string,
  ): Promise<CommandResult> {
    const membership = await this.member(gameId, userId);
    const mission = await HealthMission.findOne({
      _id: missionId,
      gameId,
      teamId: membership.state.teamId,
      status: "active",
    }).lean();
    if (!mission || mission.expiresAt <= now())
      throw new RuleError("HEALTH_MISSION_NOT_ACTIVE");
    const template = HEALTH_MISSIONS.find(
      (item) => item.id === mission.templateId,
    );
    if (
      !template ||
      !template.options[membership.role].some(
        (option) => option.key === optionKey,
      )
    )
      throw new RuleError("INVALID_HEALTH_OPTION");
    const field = `steps.${membership.role}`;
    const updated = await HealthMission.findOneAndUpdate(
      {
        _id: missionId,
        [`${field}.optionKey`]: { $exists: false },
        status: "active",
      },
      { $set: { [field]: { optionKey, userId, completedAt: now() } } },
      { new: true },
    );
    if (!updated) throw new RuleError("HEALTH_STEP_ALREADY_COMPLETED");
    let delta: number | undefined;
    if (
      ["municipality", "mrf", "broker"].every(
        (role) => updated.steps?.[role]?.optionKey,
      )
    ) {
      const answers = updated.steps as Record<Role, { optionKey: string }>;
      const outcome = healthMissionDelta(template, {
        municipality: answers.municipality.optionKey,
        mrf: answers.mrf.optionKey,
        broker: answers.broker.optionKey,
      });
      const completed = await HealthMission.updateOne(
        { _id: missionId, status: "active" },
        {
          $set: {
            status: "completed",
            completedAt: now(),
            healthDelta: outcome.delta,
          },
        },
      );
      if (completed.modifiedCount) {
        const team = await GameTeamState.findById(membership.state._id).lean();
        if (team) {
          const health = Math.max(0, Math.min(100, team.health + outcome.delta));
          await GameTeamState.updateOne(
            { _id: team._id },
            {
              $set: { health, status: healthStatus(health) },
              $inc: { revision: 1 },
            },
          );
        }
        delta = outcome.delta;
      }
    }
    await this.outbox(
      gameId,
      "health-mission.updated",
      `team:${gameId}:${membership.state.teamId}`,
      { missionId, role: membership.role, delta },
    );
    return {
      commandId,
      serverTime: now(),
      result: { missionId, completed: delta !== undefined, healthDelta: delta },
    };
  }
}
