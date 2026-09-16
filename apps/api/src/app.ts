import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import cors from "cors";
import dotenv from "dotenv";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import pinoHttp from "pino-http";
import { z } from "zod";
import {
  chatSchema,
  claimSchema,
  createTradeSchema,
  decomposeWasteSchema,
  dispatchCollectionSchema,
  errorMessages,
  externalPurchaseSchema,
  healthStepSchema,
  materialPlanSchema,
  materialTransferSchema,
  pingSchema,
  processWasteSchema,
  readinessSchema,
} from "@circular-city/contracts";
import {
  PROCESSING_METHODS,
  PROJECTS,
  STANDARD_SCENARIO,
} from "@circular-city/game-content";
import {
  calculateCo2Multiplier,
  calculateProcessing,
  defaultTeam,
  materialKeys,
  RuleError,
} from "@circular-city/game-engine";
import { requireAuth, requirePrivilege, signToken } from "./auth.js";
import { readEnv, type Env } from "./env.js";
import {
  ActivityEvent,
  ChatMessage,
  Game,
  GameAnnouncement,
  GameResultTeam,
  GameProject,
  GameTeamState,
  MaterialTransfer,
  OutboxEvent,
  ProjectWork,
  Room,
  Team,
  TradeOffer,
  Transport,
  User,
} from "./models.js";
import { GameService } from "./game-service.js";
import { emitTeamUpdated } from "./realtime.js";

dotenv.config();
const teamCreateSchema = z.object({ name: z.string().trim().min(2).max(50) });
const roomCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  maxTeams: z.number().int().min(2).max(30).default(30),
  teamId: z.string().min(1),
});
const accountIdentifierSchema = z.string().trim().min(1).max(120);
const signUpSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: accountIdentifierSchema,
  password: z.string().min(6).max(128),
});
const loginSchema = z.object({
  email: accountIdentifierSchema,
  password: z.string().min(1),
});
const service = new GameService();
const mrfGuideForSource = (source: any) => {
  return PROCESSING_METHODS.filter(
    (method) =>
      method.kind === "disposal" ||
      (method.material && (source.compositionKg?.[method.material] ?? 0) > 0),
  ).map((method) => {
    try {
      const result = calculateProcessing(source, method.id);
      const recoveredKg = materialKeys.reduce(
        (sum, material) => sum + result.outputKg[material],
        0,
      );
      return {
        methodId: method.id,
        kind: method.kind,
        targetMaterial: method.material,
        title: method.title,
        shortLabel: method.shortLabel,
        description: method.description,
        eligible: true,
        durationMs: result.durationMs,
        grade: result.grade,
        outputKg: result.outputKg,
        recoveredKg,
        residueKg: result.residueKg,
        recoveryRateBasisPoints: Math.max(
          0,
          Math.floor((recoveredKg * 10_000) / Math.max(1, source.massKg)),
        ),
        totalCostCents: result.processingCostCents,
        totalCO2Kg: result.processingCO2Kg,
        healthDelta: result.healthDelta,
      };
    } catch {
      return {
        methodId: method.id,
        kind: method.kind,
        targetMaterial: method.material,
        title: method.title,
        shortLabel: method.shortLabel,
        description: method.description,
        eligible: false,
        durationMs: method.durationMs,
        grade: null,
        outputKg: { paper: 0, plastic: 0, metal: 0, glass: 0, wood: 0 },
        recoveredKg: 0,
        residueKg: source.massKg,
        recoveryRateBasisPoints: 0,
        totalCostCents: source.massKg * method.costCentsPerKg,
        totalCO2Kg: Math.round(
          (source.massKg * method.co2MilliKgPerKg) / 1000,
        ),
        healthDelta: 0,
      };
    }
  });
};

const code = (): string =>
  randomBytes(4).toString("hex").slice(0, 6).toUpperCase();

async function createUniqueTeamInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = code();
    if (!(await Team.exists({ inviteCode }))) {
      return inviteCode;
    }
  }

  throw new RuleError("INVITE_CODE_GENERATION_FAILED");
}
const responseError = (error: unknown, response: Response): void => {
  if (error instanceof z.ZodError) {
    response.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Check the highlighted fields and try again.",
        retryable: false,
        details: error.flatten(),
      },
    });
    return;
  }
  if (error instanceof RuleError) {
    const code = error.code;
    const status =
      code === "UNAUTHENTICATED"
        ? 401
        : code.includes("NOT_AUTHORIZED") || code.includes("FORBIDDEN")
          ? 403
          : code.includes("NOT_FOUND")
            ? 404
            : code === "STALE_TEAM_REVISION"
              ? 409
              : 400;
    response.status(status).json({
      success: false,
      error: {
        code,
        message:
          errorMessages[code] ?? "This action cannot be completed right now.",
        retryable: code === "STALE_TEAM_REVISION",
        snapshotRequired: code === "STALE_TEAM_REVISION",
      },
    });
    return;
  }
  console.error(error);
  response.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected server error occurred.",
      retryable: true,
    },
  });
};
const parse = <T>(schema: z.ZodType<T>, source: unknown): T =>
  schema.parse(source);

function assertTeamLeader(team: any, userId: string): void {
  if (team.leaderUserId !== userId) {
    throw new RuleError("ROLE_NOT_AUTHORIZED");
  }
}

export const createApp = (env: Env = readEnv()): express.Express => {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp());
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: false }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_request, response) => response.json({ ok: true }));
  app.post("/v1/auth/sign-up", async (request, response) => {
    try {
      const body = parse(signUpSchema, request.body);
      const user = await User.create({
        ...body,
        passwordHash: await bcrypt.hash(body.password, 12),
        roles: ["student"],
      });
      response.status(201).json({
        success: true,
        data: {
          token: signToken(
            { userId: String(user._id), roles: user.roles },
            env,
          ),
          user: {
            id: String(user._id),
            displayName: user.displayName,
            roles: user.roles,
          },
        },
      });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.post("/v1/auth/sign-in", async (request, response) => {
    try {
      const body = parse(loginSchema, request.body);
      const user = await User.findOne({ email: body.email.toLowerCase() });
      if (!user || !(await bcrypt.compare(body.password, user.passwordHash)))
        throw new RuleError("UNAUTHENTICATED");
      response.json({
        success: true,
        data: {
          token: signToken(
            { userId: String(user._id), roles: user.roles },
            env,
          ),
          user: {
            id: String(user._id),
            displayName: user.displayName,
            roles: user.roles,
          },
        },
      });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.use("/v1", requireAuth(env));
  app.get("/v1/me", async (request, response) => {
    const user = await User.findById(request.principal!.userId).lean();
    response.json({
      success: true,
      data: user
        ? {
            id: String(user._id),
            displayName: user.displayName,
            roles: user.roles,
            accessibility: user.accessibility,
          }
        : null,
    });
  });
  app.get("/v1/me/active-game", async (request, response) => {
    const state = await GameTeamState.findOne({
      $expr: {
        $in: [
          request.principal!.userId,
          {
            $map: {
              input: { $objectToArray: "$memberRoles" },
              as: "member",
              in: "$$member.v",
            },
          },
        ],
      },
    })
      .sort({ updatedAt: -1 })
      .lean();
    const game = state
      ? await Game.findOne({
          _id: state.gameId,
          status: { $in: ["scheduled", "briefing", "active", "finalizing"] },
        }).lean()
      : null;
    const role = state
      ? Object.entries(state.memberRoles ?? {}).find(
          ([, userId]) => userId === request.principal!.userId,
        )?.[0]
      : undefined;
    response.json({
      success: true,
      data:
        game && role
          ? { gameId: String(game._id), role, status: game.status }
          : null,
    });
  });
  app.post("/v1/teams", async (request, response) => {
    try {
      const body = parse(teamCreateSchema, request.body);
      const team = await Team.create({
        name: body.name,
        inviteCode: await createUniqueTeamInviteCode(),
        leaderUserId: request.principal!.userId,
        members: [
          {
            userId: request.principal!.userId,
            displayName:
              (await User.findById(request.principal!.userId).lean())
                ?.displayName ?? "Student",
            role: null,
            ready: false,
          },
        ],
      });
      emitTeamUpdated(String(team._id));
      response.status(201).json({ success: true, data: team });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.get("/v1/teams/mine", async (request, response) =>
    response.json({
      success: true,
      data: await Team.find({ "members.userId": request.principal!.userId })
        .sort({ updatedAt: -1 })
        .lean(),
    }),
  );
  app.post("/v1/teams/join", async (request, response) => {
    try {
      const inviteCode = z
        .object({
          inviteCode: z
            .string()
            .trim()
            .min(4, "Enter the city invite code.")
            .max(6, "Enter the city invite code."),
        })
        .parse(request.body)
        .inviteCode.toUpperCase();
      const team = await Team.findOne({ inviteCode });
      if (!team) throw new RuleError("TEAM_NOT_FOUND");
      if (
        team.members.some(
          (member: { userId: string }) =>
            member.userId === request.principal!.userId,
        )
      ) {
        response.json({ success: true, data: team });
        return;
      }
      if (team.members.length >= 3) throw new RuleError("TEAM_FULL");
      const user = await User.findById(request.principal!.userId).lean();
      team.members.push({
        userId: request.principal!.userId,
        displayName: user?.displayName ?? "Student",
        role: null,
        ready: false,
      });
      await team.save();
      emitTeamUpdated(String(team._id));
      response.json({ success: true, data: team });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.get("/v1/teams/:teamId", async (request, response) => {
    const team = await Team.findById(request.params.teamId).lean();
    if (
      !team?.members.some(
        (member: { userId: string }) =>
          member.userId === request.principal!.userId,
      )
    ) {
      response.status(404).json({
        success: false,
        error: {
          code: "TEAM_NOT_FOUND",
          message: "Team not found.",
          retryable: false,
        },
      });
      return;
    }
    const matchRoom = await Room.findOne({
      "seating.teamId": String(team._id),
    }).lean();
    const game = matchRoom
      ? await Game.findOne({ roomId: String(matchRoom._id) })
          .select("_id status startedAt")
          .lean()
      : null;
    response.json({
      success: true,
      data: {
        ...team,
        matchRoom: matchRoom
          ? {
              code: matchRoom.code,
              name: matchRoom.name,
              status: matchRoom.status,
              gameId: game ? String(game._id) : null,
              gameStatus: game?.status ?? null,
            }
          : null,
      },
    });
  });
  app.post("/v1/teams/:teamId/roles", async (request, response) => {
    try {
      const role = z
        .object({ role: z.enum(["municipality", "mrf", "broker"]) })
        .parse(request.body).role;
      const team = await Team.findById(request.params.teamId);
      if (
        !team?.members.some(
          (member: { userId: string }) =>
            member.userId === request.principal!.userId,
        )
      )
        throw new RuleError("TEAM_MEMBERSHIP_REQUIRED");
      if (
        team.members.some(
          (member: { userId: string; role?: string }) =>
            member.role === role && member.userId !== request.principal!.userId,
        )
      )
        throw new RuleError("ROLE_ALREADY_SELECTED");
      for (const member of team.members)
        if (member.userId === request.principal!.userId) {
          member.role = role;
          member.ready = false;
        }
      team.status = team.members.every(
        (member: { role?: string }) => member.role,
      )
        ? "role-selecting"
        : "forming";
      await team.save();
      emitTeamUpdated(String(team._id));
      response.json({ success: true, data: team });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.post("/v1/teams/:teamId/ready", async (request, response) => {
    try {
      const team = await Team.findById(request.params.teamId);
      const currentMember = team?.members.find(
        (member: { userId: string }) =>
          member.userId === request.principal!.userId,
      );

      if (!team || !currentMember) {
        throw new RuleError("TEAM_MEMBERSHIP_REQUIRED");
      }

      if (team.members.length !== 3) {
        throw new RuleError("TEAM_INCOMPLETE");
      }

      if (!currentMember.role) {
        throw new RuleError("ROLE_NOT_SELECTED");
      }

      if (team.members.some((member: { role?: string }) => !member.role)) {
        throw new RuleError("ROLE_SELECTION_INCOMPLETE");
      }

      currentMember.ready = true;
      if (
        team.members.length === 3 &&
        team.members.every(
          (member: { role?: string; ready: boolean }) =>
            member.role && member.ready,
        )
      )
        team.status = "ready";
      await team.save();
      emitTeamUpdated(String(team._id));
      response.json({ success: true, data: team });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.get("/v1/rooms", async (_request, response) => {
    const rooms = await Room.find({ status: "waiting" })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    const teamIds = rooms.flatMap((room) =>
      room.seating.map((seat: { teamId: string }) => seat.teamId),
    );
    const teams = await Team.find({ _id: { $in: teamIds } })
      .select("name")
      .lean();
    const teamNames = new Map(
      teams.map((team) => [String(team._id), team.name]),
    );

    response.json({
      success: true,
      data: rooms.map((room) => ({
        ...room,
        seatedTeams: room.seating.map(
          (seat: { teamId: string; citySlot: number }) => ({
            ...seat,
            name: teamNames.get(seat.teamId) ?? "City team",
          }),
        ),
      })),
    });
  });
  app.post("/v1/rooms", async (request, response) => {
    try {
      const body = parse(roomCreateSchema, request.body);
      const team = await Team.findById(body.teamId);
      if (!team || team.status !== "ready") {
        throw new RuleError("TEAM_NOT_READY");
      }
      assertTeamLeader(team, request.principal!.userId);
      const room = await Room.create({
        code: code(),
        name: body.name,
        ownerUserId: request.principal!.userId,
        maxTeams: body.maxTeams,
        facilitatorUserId:
          request.principal!.roles.includes("facilitator") ||
          request.principal!.roles.includes("admin")
            ? request.principal!.userId
            : undefined,
        seating: [
          {
            teamId: String(team._id),
            citySlot: 1,
            joinedAt: Date.now(),
          },
        ],
      });
      team.status = "in-room";
      await team.save();
      emitTeamUpdated(String(team._id));
      response.status(201).json({ success: true, data: room });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.post("/v1/rooms/:code/join", async (request, response) => {
    try {
      const teamId = z
        .object({ teamId: z.string().min(1) })
        .parse(request.body).teamId;
      const room = await Room.findOne({
        code: request.params.code,
        status: "waiting",
      });
      const team = await Team.findById(teamId);
      if (!room || !team) throw new RuleError("ROOM_OR_TEAM_NOT_FOUND");
      assertTeamLeader(team, request.principal!.userId);
      if (team.status !== "ready") throw new RuleError("TEAM_NOT_READY");
      if (
        room.seating.some((seat: { teamId: string }) => seat.teamId === teamId)
      ) {
        response.json({ success: true, data: room });
        return;
      }
      if (room.seating.length >= room.maxTeams)
        throw new RuleError("ROOM_FULL");
      room.seating.push({
        teamId,
        citySlot: room.seating.length + 1,
        joinedAt: Date.now(),
      });
      team.status = "in-room";
      await Promise.all([room.save(), team.save()]);
      emitTeamUpdated(String(team._id));
      response.json({ success: true, data: room });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.post("/v1/rooms/:code/quit", async (request, response) => {
    try {
      const teamId = z
        .object({ teamId: z.string().min(1) })
        .parse(request.body).teamId;
      const room = await Room.findOne({
        code: request.params.code,
        status: "waiting",
      });
      const team = await Team.findById(teamId);
      if (!room || !team) throw new RuleError("ROOM_OR_TEAM_NOT_FOUND");
      assertTeamLeader(team, request.principal!.userId);
      if (
        !room.seating.some((seat: { teamId: string }) => seat.teamId === teamId)
      ) {
        throw new RuleError("TEAM_NOT_SEATED");
      }
      room.seating = room.seating
        .filter((seat: { teamId: string }) => seat.teamId !== teamId)
        .map((seat: { teamId: string }, index: number) => ({
          ...seat,
          citySlot: index + 1,
        }));
      team.status = "ready";
      await Promise.all([room.save(), team.save()]);
      emitTeamUpdated(String(team._id));
      response.json({ success: true, data: room });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.post("/v1/rooms/:code/start", async (request, response) => {
    try {
      const room = await Room.findOne({
        code: request.params.code,
        status: "waiting",
      });
      if (
        !room ||
        (room.ownerUserId !== request.principal!.userId &&
          room.facilitatorUserId !== request.principal!.userId &&
          !request.principal!.roles.some((role) =>
            ["facilitator", "admin"].includes(role),
          ))
      )
        throw new RuleError("ROLE_NOT_AUTHORIZED");
      if (room.seating.length < 2)
        throw new RuleError("MINIMUM_TEAMS_REQUIRED");
      const teams = await Team.find({
        _id: {
          $in: room.seating.map((seat: { teamId: string }) => seat.teamId),
        },
        status: { $in: ["ready", "in-room"] },
      }).lean();
      if (
        teams.length !== room.seating.length ||
        teams.some(
          (team) =>
            team.members.length !== 3 ||
            !team.members.every(
              (member: { role?: string; ready: boolean }) =>
                member.role && member.ready,
            ),
        )
      )
        throw new RuleError("TEAM_NOT_READY");
      const start = Date.now();
      const seed = Math.floor(Math.random() * 2 ** 31);
      const game = await Game.create({
        roomId: String(room._id),
        seed,
        configSnapshot: STANDARD_SCENARIO,
        status: "active",
        startedAt: start,
        activeStartedAt: start,
        activeEndsAt: start + STANDARD_SCENARIO.activeMs,
        finalizationEndsAt:
          start + STANDARD_SCENARIO.activeMs + STANDARD_SCENARIO.finalizationMs,
        nextScheduledAt: start,
        projectCursor: 1,
        projectPreviewCursor: 1,
        participantTeamIds: room.seating.map(
          (seat: { teamId: string }) => seat.teamId,
        ),
      });
      await GameTeamState.insertMany(
        room.seating.map((seat: { teamId: string; citySlot: number }) => ({
          gameId: String(game._id),
          teamId: seat.teamId,
          ...defaultTeam(seat.teamId, seat.citySlot),
          memberRoles: Object.fromEntries(
            teams
              .find((team: any) => String(team._id) === seat.teamId)!
              .members.map((member: { role: string; userId: string }) => [
                member.role,
                member.userId,
              ]),
          ),
        })),
      );
      const firstProject = PROJECTS[seed % 2]!;
      await GameProject.create({
        gameId: String(game._id),
        sequence: 1,
        templateId: firstProject.id,
        template: firstProject,
        status: "active",
        previewAt: start,
        announcementAt: start,
        activeAt: start,
        expiresAt: start + firstProject.activeDurationMs,
      });
      room.status = "started";
      await room.save();
      for (const seatedTeam of room.seating) emitTeamUpdated(seatedTeam.teamId);
      response.json({
        success: true,
        data: { gameId: String(game._id), countdownEndsAt: game.activeEndsAt },
      });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.get("/v1/games/:gameId/snapshot", async (request, response) => {
    try {
      const membership = await service.member(
        request.params.gameId,
        request.principal!.userId,
        true,
      );
      const game = await Game.findById(request.params.gameId).lean();
      const projects = await GameProject.find({ gameId: request.params.gameId })
        .sort({ sequence: 1 })
        .lean();
      const work = await ProjectWork.find({
        gameId: request.params.gameId,
        teamId: membership.state.teamId,
        status: "open",
      }).lean();
      const [
        wasteSources,
        jobs,
        mission,
        trades,
        transports,
        materialTransfers,
        leaderboard,
        chatMessages,
        globalChatMessages,
        announcements,
      ] = await Promise.all([
        mongoose
          .model("WasteSource")
          .find({
            gameId: request.params.gameId,
            teamId: membership.state.teamId,
            status: {
              $in: ["available", "in_transit", "at_mrf", "held", "processing"],
            },
          })
          .lean(),
        mongoose
          .model("ProcessJob")
          .find({
            gameId: request.params.gameId,
            teamId: membership.state.teamId,
            status: "processing",
          })
          .lean(),
        mongoose
          .model("HealthMission")
          .findOne({
            gameId: request.params.gameId,
            teamId: membership.state.teamId,
            status: "active",
          })
          .lean(),
        mongoose
          .model("TradeOffer")
          .find({
            gameId: request.params.gameId,
            $or: [
              { offeringTeamId: membership.state.teamId },
              { recipientTeamId: membership.state.teamId },
            ],
          })
          .lean(),
        Transport.find({
          gameId: request.params.gameId,
          teamId: membership.state.teamId,
          status: "in_transit",
        }).lean(),
        MaterialTransfer.find({
          gameId: request.params.gameId,
          teamId: membership.state.teamId,
          status: "in_transit",
        })
          .sort({ arrivesAt: 1 })
          .lean(),
        GameTeamState.find({ gameId: request.params.gameId })
          .sort({ citySlot: 1 })
          .select("teamId citySlot status totalCO2Kg walletCents")
          .lean(),
        ChatMessage.find({
          gameId: request.params.gameId,
          teamId: membership.state.teamId,
          channel: "team",
        })
          .sort({ createdAtMs: -1 })
          .limit(50)
          .lean(),
        ChatMessage.find({
          gameId: request.params.gameId,
          channel: "global",
        })
          .sort({ createdAtMs: -1 })
          .limit(100)
          .lean(),
        GameAnnouncement.find({ gameId: request.params.gameId })
          .sort({ createdAtMs: -1 })
          .limit(50)
          .lean(),
      ]);
      const teamNameDocs = await Team.find({
        _id: { $in: leaderboard.map((entry) => entry.teamId) },
      })
        .select("name")
        .lean();
      const teamNameById = new Map(
        teamNameDocs.map((entry) => [String(entry._id), entry.name]),
      );
      const rewardMultiplierBasisPoints = calculateCo2Multiplier(
        membership.state as any,
        leaderboard.map((entry) => ({
          status: entry.status,
          totalCO2Kg: entry.totalCO2Kg,
        })) as any,
      ).multiplierBasisPoints;
      const publicLeaderboard = leaderboard
        .map((entry) => ({
          teamId: entry.teamId,
          citySlot: entry.citySlot,
          name:
            teamNameById.get(String(entry.teamId)) ??
            `City ${entry.citySlot ?? "?"}`,
          walletCents: entry.walletCents ?? 0,
          rewardMultiplierBasisPoints: calculateCo2Multiplier(
            entry as any,
            leaderboard as any,
          ).multiplierBasisPoints,
        }))
        .sort(
          (left, right) =>
            right.walletCents - left.walletCents ||
            (left.citySlot ?? Number.MAX_SAFE_INTEGER) -
              (right.citySlot ?? Number.MAX_SAFE_INTEGER) ||
            String(left.teamId).localeCompare(String(right.teamId)),
        )
        .map((entry, index) => ({ ...entry, rank: index + 1 }));
      const snapshotTime = Date.now();
      const overdueActive = projects.filter(
        (project) =>
          project.status === "active" &&
          typeof project.expiresAt === "number" &&
          project.expiresAt <= snapshotTime,
      );
      const activeProjects = projects.filter(
        (project) =>
          project.status === "active" &&
          (!project.expiresAt || project.expiresAt > snapshotTime),
      );
      const recentlyClosed = projects
        .filter((project) =>
          ["claimed", "expired", "cancelled"].includes(project.status),
        )
        .concat(
          overdueActive.map((project) => ({
            ...project,
            status: "expired" as const,
          })),
        )
        .slice(-24);
      response.json({
        success: true,
        data: {
          game: {
            id: String(game!._id),
            status: game!.status,
            serverTime: snapshotTime,
            activeEndsAt: game!.activeEndsAt,
            finalizationEndsAt: game!.finalizationEndsAt,
            revision: game!.globalRevision,
          },
          viewer: {
            userId: request.principal!.userId,
            teamId: membership.state.teamId,
            role: membership.role,
          },
          team: {
            ...membership.state,
            rewardMultiplierBasisPoints,
            wasteSources,
            activeJobs: jobs,
            transports,
            materialTransfers,
            currentHealthMission: mission,
            mrfActionGuide: Object.fromEntries(
              wasteSources
                .filter((source: any) => source.status === "held")
                .map((source: any) => [source._id, mrfGuideForSource(source)]),
            ),
          },
          projects: {
            preview: projects.filter(
              (project) => project.status === "announced",
            ),
            active: activeProjects,
            queued: projects.filter((project) => project.status === "queued"),
            recentlyClosed,
          },
          teamProjectWork: work,
          trades,
          chatMessages: chatMessages.reverse(),
          globalChatMessages: globalChatMessages.reverse(),
          announcements: announcements.reverse(),
          publicLeaderboard,
        },
      });
    } catch (error) {
      responseError(error, response);
    }
  });
  const command =
    <T>(
      schema: z.ZodType<T>,
      run: (body: T, request: Request) => Promise<unknown>,
    ) =>
    async (request: Request, response: Response) => {
      try {
        const body = parse(schema, request.body);
        const key = request.header("idempotency-key");
        if (!key) throw new RuleError("IDEMPOTENCY_KEY_REQUIRED");
        const result = await service.idempotent(
          key,
          request.principal!.userId,
          request.method,
          request.path,
          body,
          () => run(body, request),
        );
        response.json({ success: true, data: result });
      } catch (error) {
        responseError(error, response);
      }
    };
  app.post(
    "/v1/games/:gameId/municipality/collections",
    command(dispatchCollectionSchema, (body, request) =>
      service.dispatchCollection(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        body.expectedTeamRevision,
        body.payload.wasteSourceId,
        body.payload.route,
      ),
    ),
  );
  app.post(
    "/v1/games/:gameId/mrf/processes",
    command(processWasteSchema, (body, request) =>
      service.startProcess(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        body.expectedTeamRevision,
        body.payload.wasteSourceId,
        body.payload.methodId,
      ),
    ),
  );
  app.post(
    "/v1/games/:gameId/mrf/decompositions",
    command(decomposeWasteSchema, (body, request) =>
      service.decomposeWaste(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        body.expectedTeamRevision,
        body.payload.wasteSourceId,
      ),
    ),
  );
  app.post(
    "/v1/games/:gameId/material-transfers",
    command(materialTransferSchema, (body, request) =>
      service.createMaterialTransfer(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        body.expectedTeamRevision,
        body.payload.toRole,
        body.payload.materialType,
        body.payload.grade,
        body.payload.quantityKg,
        body.payload.route,
      ),
    ),
  );
  app.post(
    "/v1/games/:gameId/broker/external-purchases",
    command(externalPurchaseSchema, (body, request) =>
      service.externalPurchase(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        body.expectedTeamRevision,
        body.payload.materialType,
        body.payload.quantityKg,
      ),
    ),
  );
  app.put(
    "/v1/games/:gameId/projects/:projectId/material-plan",
    command(materialPlanSchema, (body, request) =>
      service.savePlan(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        String(request.params.projectId),
        body.expectedWorkRevision,
        body.payload.materials,
      ),
    ),
  );
  for (const role of ["municipality", "mrf", "broker"] as const)
    app.post(
      `/v1/games/:gameId/projects/:projectId/readiness/${role}`,
      command(readinessSchema, (body, request) =>
        service.setReadiness(
          String(request.params.gameId),
          request.principal!.userId,
          body.commandId,
          String(request.params.projectId),
          role,
          body.payload.value,
        ),
      ),
    );
  app.post(
    "/v1/games/:gameId/projects/:projectId/claim",
    command(claimSchema, (body, request) =>
      service.claimProject(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        String(request.params.projectId),
        body.expectedTeamRevision,
      ),
    ),
  );
  app.post(
    "/v1/games/:gameId/broker/trades",
    command(createTradeSchema, (body, request) =>
      service.createTrade(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        body.expectedTeamRevision,
        body.payload.recipientTeamId,
        body.payload.terms as any,
      ),
    ),
  );
  for (const action of ["accept", "reject", "cancel"] as const)
    app.post(
      `/v1/games/:gameId/broker/trades/:tradeOfferId/${action}`,
      command(
        z.object({
          commandId: z.string().uuid(),
          payload: z.object({}).optional(),
        }),
        (body, request) =>
          service.settleTrade(
            String(request.params.gameId),
            request.principal!.userId,
            body.commandId,
            String(request.params.tradeOfferId),
            action,
          ),
      ),
    );
  app.post(
    "/v1/games/:gameId/health-missions/:missionId/steps",
    command(healthStepSchema, (body, request) =>
      service.healthStep(
        String(request.params.gameId),
        request.principal!.userId,
        body.commandId,
        String(request.params.missionId),
        body.payload.optionKey,
      ),
    ),
  );
  app.post(
    "/v1/games/:gameId/chat/messages",
    command(chatSchema, async (body, request) => {
      const gameId = String(request.params.gameId);
      const membership = await service.member(
        gameId,
        request.principal!.userId,
      );
      if (
        body.payload.channel !== "team" &&
        body.payload.channel !== "global"
      ) {
        const tradeId = body.payload.channel.startsWith("trade:")
          ? body.payload.channel.slice(6)
          : "";
        const trade = tradeId
          ? await TradeOffer.findOne({ _id: tradeId, gameId }).lean()
          : null;
        if (
          !trade ||
          ![trade.offeringTeamId, trade.recipientTeamId].includes(
            membership.state.teamId,
          )
        )
          throw new RuleError("CHAT_CHANNEL_NOT_AUTHORIZED");
      }
      const recentMessages = await ChatMessage.countDocuments({
        gameId,
        senderUserId: request.principal!.userId,
        createdAtMs: { $gt: Date.now() - 10_000 },
      });
      if (recentMessages >= 8) throw new RuleError("CHAT_RATE_LIMITED");
      const chat = await ChatMessage.create({
        gameId,
        teamId: membership.state.teamId,
        channel: body.payload.channel,
        senderUserId: request.principal!.userId,
        senderName:
          membership.team.members.find(
            (member: any) => member.userId === request.principal!.userId,
          )?.displayName ?? "Teammate",
        senderRole: membership.role,
        content: body.payload.message.replace(/[<>]/g, ""),
        createdAtMs: Date.now(),
      });
      await OutboxEvent.create({
        gameId,
        eventType: "chat.message.created",
        target:
          body.payload.channel === "team"
            ? `team:${gameId}:${membership.state.teamId}`
            : body.payload.channel === "global"
              ? `game:${gameId}`
              : `trade:${gameId}:${body.payload.channel.slice(6)}`,
        payload: chat.toObject(),
        createdAtMs: Date.now(),
      });
      return {
        commandId: body.commandId,
        serverTime: Date.now(),
        result: { message: chat },
      };
    }),
  );
  app.post(
    "/v1/games/:gameId/pings",
    command(pingSchema, async (body, request) => {
      const gameId = String(request.params.gameId);
      const membership = await service.member(
        gameId,
        request.principal!.userId,
      );
      const recentPings = await ActivityEvent.countDocuments({
        gameId,
        actorUserId: request.principal!.userId,
        type: "ping.created",
        occurredAt: { $gt: Date.now() - 10_000 },
      });
      if (recentPings >= 12) throw new RuleError("PING_RATE_LIMITED");
      const event = {
        ...body.payload,
        userId: request.principal!.userId,
        role: membership.role,
        createdAt: Date.now(),
      };
      await OutboxEvent.create({
        gameId,
        eventType: "ping.created",
        target: `team:${gameId}:${membership.state.teamId}`,
        payload: event,
        createdAtMs: Date.now(),
      });
      await ActivityEvent.create({
        gameId,
        teamId: membership.state.teamId,
        actorType: "player",
        actorUserId: request.principal!.userId,
        actorRole: membership.role,
        type: "ping.created",
        occurredAt: event.createdAt,
        visibility: "team",
        payload: event,
      });
      return {
        commandId: body.commandId,
        serverTime: Date.now(),
        result: event,
      };
    }),
  );
  app.post("/v1/games/:gameId/chatbot/messages", async (request, response) => {
    try {
      const membership = await service.member(
        request.params.gameId,
        request.principal!.userId,
      );
      const message = z
        .object({
          message: z.string().trim().min(1).max(1000),
          context: z.enum(["municipality", "mrf", "broker"]).optional(),
        })
        .parse(request.body);
      const recentRequests = await ActivityEvent.countDocuments({
        gameId: request.params.gameId,
        actorUserId: request.principal!.userId,
        type: "chatbot.requested",
        occurredAt: { $gt: Date.now() - 60_000 },
      });
      if (recentRequests >= 5) throw new RuleError("CHATBOT_RATE_LIMITED");
      const reply = `Game Coach: review your shared inventory, active project requirements, and City Health before choosing. This is guidance, not an action. Your ${membership.role} workstation has the authoritative options.`;
      await ActivityEvent.create({
        gameId: request.params.gameId,
        teamId: membership.state.teamId,
        actorType: "player",
        actorUserId: request.principal!.userId,
        actorRole: membership.role,
        type: "chatbot.requested",
        occurredAt: Date.now(),
        visibility: "private",
        payload: {
          context: message.context,
          length: message.message.length,
          provider: "disabled-safe-coach",
        },
      });
      response.json({ success: true, data: { reply, provider: "safe-local" } });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.get("/v1/games/:gameId/results", async (request, response) => {
    try {
      await service.member(
        request.params.gameId,
        request.principal!.userId,
        true,
      );
      const game = await Game.findById(request.params.gameId).lean();
      const results = await GameResultTeam.find({
        gameId: request.params.gameId,
      })
        .sort({ rank: 1 })
        .lean();
      const teams = results.length
        ? results
        : await GameTeamState.find({ gameId: request.params.gameId })
            .sort({
              walletCents: -1,
              totalCO2Kg: 1,
              health: -1,
              lastProjectClaimedAt: 1,
              citySlot: 1,
            })
            .lean();
      response.json({
        success: true,
        data: {
          game,
          teams: results.length
            ? teams
            : teams.map((team, index) => ({ ...team, rank: index + 1 })),
        },
      });
    } catch (error) {
      responseError(error, response);
    }
  });
  app.get(
    "/v1/admin/games/:gameId/monitor",
    requirePrivilege("facilitator", "admin"),
    async (request, response) => {
      try {
        const [game, teams, projects, trades, events] = await Promise.all([
          Game.findById(request.params.gameId).lean(),
          GameTeamState.find({ gameId: request.params.gameId }).lean(),
          GameProject.find({ gameId: request.params.gameId }).lean(),
          mongoose
            .model("TradeOffer")
            .find({ gameId: request.params.gameId })
            .lean(),
          ActivityEvent.find({ gameId: request.params.gameId })
            .sort({ occurredAt: -1 })
            .limit(100)
            .lean(),
        ]);
        response.json({
          success: true,
          data: { game, teams, projects, trades, events },
        });
      } catch (error) {
        responseError(error, response);
      }
    },
  );
  app.post(
    "/v1/admin/games/:gameId/:control",
    requirePrivilege("facilitator", "admin"),
    async (request, response) => {
      try {
        const control = z
          .enum(["pause", "resume", "end"])
          .parse(request.params.control);
        const game = await Game.findById(request.params.gameId);
        if (!game) throw new RuleError("GAME_NOT_FOUND");
        if (control === "pause") {
          game.status = "paused";
          game.pausedAt = Date.now();
        } else if (control === "end") {
          game.status = "completed";
          game.completedAt = Date.now();
        } else if (game.status === "paused") {
          const delta = Date.now() - (game.pausedAt ?? Date.now());
          game.status =
            game.activeEndsAt && Date.now() >= game.activeEndsAt
              ? "finalizing"
              : "active";
          game.activeEndsAt = (game.activeEndsAt ?? 0) + delta;
          game.finalizationEndsAt = (game.finalizationEndsAt ?? 0) + delta;
          game.pausedAt = undefined;
        }
        await game.save();
        await ActivityEvent.create({
          gameId: request.params.gameId,
          actorType: "admin",
          actorUserId: request.principal!.userId,
          type: `admin.${control}`,
          occurredAt: Date.now(),
          visibility: "admin",
          payload: {},
        });
        await OutboxEvent.create({
          gameId: request.params.gameId,
          eventType: "game.status.changed",
          target: `game:${request.params.gameId}`,
          payload: { status: game.status },
          createdAtMs: Date.now(),
        });
        response.json({ success: true, data: { status: game.status } });
      } catch (error) {
        responseError(error, response);
      }
    },
  );
  app.use("/v1", (_request, response) =>
    response.status(404).json({
      success: false,
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "The requested game API route does not exist.",
        retryable: false,
      },
    }),
  );
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => responseError(error, response),
  );
  return app;
};
