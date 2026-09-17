import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { PROJECTS } from "@circular-city/game-content";
import { defaultTeam } from "@circular-city/game-engine";
import { signToken } from "../../src/auth.js";
import { createApp } from "../../src/app.js";
import { GameService } from "../../src/game-service.js";
import {
  ChatMessage,
  Game,
  GameAnnouncement,
  GameProject,
  GameTeamState,
  MaterialTransfer,
  OutboxEvent,
  ProcessJob,
  QualityUpgradeJob,
  Team,
  TradeOffer,
  Transport,
  User,
  WasteSource,
} from "../../src/models.js";

const env = {
  NODE_ENV: "test" as const,
  API_PORT: 0,
  MONGODB_URI: "",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "integration-test-secret-that-is-long-enough",
  WEB_ORIGIN: "http://localhost:3000",
  DNS_SERVERS: ["8.8.8.8"],
  CHATBOT_PROVIDER: "disabled" as const,
};

describe("authoritative game safety", () => {
  let replicaSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    env.MONGODB_URI = replicaSet.getUri();
    await mongoose.connect(env.MONGODB_URI);
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replicaSet.stop();
  });

  test("serializes concurrent uses of the same idempotency key", async () => {
    const service = new GameService();
    let mutations = 0;
    const execute = () =>
      service.idempotent(
        "same-command",
        "student-1",
        "POST",
        "/v1/example",
        { action: "collect" },
        async () => {
          mutations += 1;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { accepted: true, mutations };
        },
      );

    const [first, second] = await Promise.all([execute(), execute()]);
    expect(mutations).toBe(1);
    expect(first).toEqual(second);
  });

  test("keeps team chat out of another team's snapshot", async () => {
    const [firstUser, secondUser] = await Promise.all([
      User.create({
        displayName: "City One",
        email: "city-one@example.test",
        passwordHash: "not-used",
      }),
      User.create({
        displayName: "City Two",
        email: "city-two@example.test",
        passwordHash: "not-used",
      }),
    ]);
    const [firstTeam, secondTeam] = await Promise.all([
      Team.create({
        name: "City One",
        inviteCode: "ONE111",
        leaderUserId: String(firstUser._id),
        members: [
          {
            userId: String(firstUser._id),
            displayName: "City One",
            role: "municipality",
            ready: true,
          },
        ],
        status: "in-room",
      }),
      Team.create({
        name: "City Two",
        inviteCode: "TWO222",
        leaderUserId: String(secondUser._id),
        members: [
          {
            userId: String(secondUser._id),
            displayName: "City Two",
            role: "municipality",
            ready: true,
          },
        ],
        status: "in-room",
      }),
    ]);
    const game = await Game.create({
      roomId: "room-for-chat-privacy",
      status: "active",
      startedAt: Date.now(),
      activeEndsAt: Date.now() + 60_000,
      participantTeamIds: [String(firstTeam._id), String(secondTeam._id)],
    });
    await GameTeamState.insertMany([
      {
        gameId: String(game._id),
        teamId: String(firstTeam._id),
        ...defaultTeam(String(firstTeam._id), 1),
        memberRoles: { municipality: String(firstUser._id) },
      },
      {
        gameId: String(game._id),
        teamId: String(secondTeam._id),
        ...defaultTeam(String(secondTeam._id), 2),
        memberRoles: { municipality: String(secondUser._id) },
      },
    ]);
    await ChatMessage.create({
      gameId: String(game._id),
      teamId: String(firstTeam._id),
      channel: "team",
      senderUserId: String(firstUser._id),
      senderRole: "municipality",
      content: "Private city-one plan",
      createdAtMs: Date.now(),
    });

    const app = createApp(env);
    const firstToken = signToken(
      { userId: String(firstUser._id), roles: ["student"] },
      env,
    );
    const secondToken = signToken(
      { userId: String(secondUser._id), roles: ["student"] },
      env,
    );
    const postedMessage = await request(app)
      .post(`/v1/games/${game._id}/chat/messages`)
      .set("authorization", `Bearer ${firstToken}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000061")
      .send({
        commandId: "00000000-0000-4000-8000-000000000061",
        payload: { channel: "team", message: "MRF, please prepare the paper batch." },
      });
    expect(postedMessage.status).toBe(200);
    expect(postedMessage.body.data.result.message).toMatchObject({
      senderName: "City One",
      senderRole: "municipality",
    });
    const globalMessage = await request(app)
      .post(`/v1/games/${game._id}/chat/messages`)
      .set("authorization", `Bearer ${firstToken}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000062")
      .send({
        commandId: "00000000-0000-4000-8000-000000000062",
        payload: { channel: "global", message: "Hello from City One." },
      });
    expect(globalMessage.status).toBe(200);
    const [ownSnapshot, otherSnapshot] = await Promise.all([
      request(app)
        .get(`/v1/games/${game._id}/snapshot`)
        .set("authorization", `Bearer ${firstToken}`),
      request(app)
        .get(`/v1/games/${game._id}/snapshot`)
        .set("authorization", `Bearer ${secondToken}`),
    ]);

    expect(ownSnapshot.status).toBe(200);
    expect(ownSnapshot.body.data.chatMessages).toHaveLength(2);
    expect(ownSnapshot.body.data.chatMessages.at(-1)).toMatchObject({
      senderName: "City One",
      content: "MRF, please prepare the paper batch.",
    });
    expect(otherSnapshot.status).toBe(200);
    expect(otherSnapshot.body.data.chatMessages).toEqual([]);
    expect(ownSnapshot.body.data.globalChatMessages).toEqual([
      expect.objectContaining({
        senderName: "City One",
        content: "Hello from City One.",
      }),
    ]);
    expect(otherSnapshot.body.data.globalChatMessages).toEqual([
      expect.objectContaining({
        senderName: "City One",
        content: "Hello from City One.",
      }),
    ]);

    const activeGame = await request(app)
      .get("/v1/me/active-game")
      .set("authorization", `Bearer ${secondToken}`);
    expect(activeGame.body.data).toMatchObject({
      gameId: String(game._id),
      role: "municipality",
    });

    const source = await WasteSource.create({
      gameId: String(game._id),
      teamId: String(firstTeam._id),
      massKg: 1000,
      compositionKg: { paper: 1000, plastic: 0, metal: 0, glass: 0, wood: 0 },
      contaminationBasisPoints: 500,
      status: "available",
      expiresAt: Date.now() + 60_000,
    });
    const collection = await request(app)
      .post(`/v1/games/${game._id}/municipality/collections`)
      .set("authorization", `Bearer ${firstToken}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000001")
      .send({
        commandId: "00000000-0000-4000-8000-000000000001",
        expectedTeamRevision: 0,
        payload: { wasteSourceId: String(source._id), route: "standard" },
      });
    expect(collection.status).toBe(200);
    expect(await WasteSource.findById(source._id).lean()).toMatchObject({
      status: "in_transit",
    });
    expect(
      await Transport.findOne({
        gameId: String(game._id),
        wasteSourceId: String(source._id),
      }).lean(),
    ).toMatchObject({ status: "in_transit", route: "standard" });
    expect(
      await ProcessJob.countDocuments({
        gameId: String(game._id),
        teamId: String(firstTeam._id),
      }),
    ).toBe(0);
    const materialTransfer = await request(app)
      .post(`/v1/games/${game._id}/material-transfers`)
      .set("authorization", `Bearer ${firstToken}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000002")
      .send({
        commandId: "00000000-0000-4000-8000-000000000002",
        expectedTeamRevision: 1,
        payload: {
          toRole: "mrf",
          materialType: "paper",
          grade: "B",
          quantityKg: 100,
          route: "standard",
        },
      });
    expect(materialTransfer.status).toBe(403);
    expect(materialTransfer.body.error.code).toBe("ROLE_NOT_AUTHORIZED");
  });

  test("projects wallet-ranked city standings with live CO2 multipliers", async () => {
    const user = await User.create({
      displayName: "Leaderboard Player",
      email: "leaderboard@example.test",
      passwordHash: "not-used",
    });
    const [north, central, south] = await Promise.all([
      Team.create({
        name: "North City",
        inviteCode: "NORTH1",
        leaderUserId: String(user._id),
        members: [
          {
            userId: String(user._id),
            displayName: "Leaderboard Player",
            role: "municipality",
            ready: true,
          },
        ],
        status: "in-room",
      }),
      Team.create({
        name: "Central City",
        inviteCode: "CENTR1",
        leaderUserId: "central-leader",
        members: [],
        status: "in-room",
      }),
      Team.create({
        name: "South City",
        inviteCode: "SOUTH1",
        leaderUserId: "south-leader",
        members: [],
        status: "in-room",
      }),
    ]);
    const game = await Game.create({
      roomId: "room-for-live-leaderboard",
      status: "active",
      startedAt: Date.now(),
      activeEndsAt: Date.now() + 60_000,
      participantTeamIds: [String(north._id), String(central._id), String(south._id)],
    });
    await GameTeamState.insertMany([
      {
        gameId: String(game._id),
        teamId: String(north._id),
        ...defaultTeam(String(north._id), 2),
        walletCents: 90_000,
        totalCO2Kg: 100,
        memberRoles: { municipality: String(user._id) },
      },
      {
        gameId: String(game._id),
        teamId: String(central._id),
        ...defaultTeam(String(central._id), 1),
        walletCents: 90_000,
        totalCO2Kg: 200,
        memberRoles: {},
      },
      {
        gameId: String(game._id),
        teamId: String(south._id),
        ...defaultTeam(String(south._id), 3),
        walletCents: 40_000,
        totalCO2Kg: 300,
        memberRoles: {},
      },
    ]);
    const app = createApp(env);
    const token = signToken({ userId: String(user._id), roles: ["student"] }, env);
    const firstSnapshot = await request(app)
      .get(`/v1/games/${game._id}/snapshot`)
      .set("authorization", `Bearer ${token}`);

    expect(firstSnapshot.status).toBe(200);
    expect(firstSnapshot.body.data.publicLeaderboard).toEqual([
      expect.objectContaining({
        teamId: String(central._id),
        name: "Central City",
        walletCents: 90_000,
        rewardMultiplierBasisPoints: 10_000,
        rank: 1,
      }),
      expect.objectContaining({
        teamId: String(north._id),
        name: "North City",
        walletCents: 90_000,
        rewardMultiplierBasisPoints: 20_000,
        rank: 2,
      }),
      expect.objectContaining({
        teamId: String(south._id),
        name: "South City",
        walletCents: 40_000,
        rewardMultiplierBasisPoints: 6_667,
        rank: 3,
      }),
    ]);
    const leaderboardResponse = await request(app)
      .get(`/v1/games/${game._id}/leaderboard`)
      .set("authorization", `Bearer ${token}`);
    expect(leaderboardResponse.status).toBe(200);
    expect(leaderboardResponse.body.data).toEqual(
      firstSnapshot.body.data.publicLeaderboard,
    );

    await GameTeamState.updateOne(
      { gameId: String(game._id), teamId: String(south._id) },
      { $set: { walletCents: 120_000 } },
    );
    const secondSnapshot = await request(app)
      .get(`/v1/games/${game._id}/snapshot`)
      .set("authorization", `Bearer ${token}`);

    expect(
      secondSnapshot.body.data.publicLeaderboard.map((entry: any) => ({
        teamId: entry.teamId,
        rank: entry.rank,
      })),
    ).toEqual([
      { teamId: String(south._id), rank: 1 },
      { teamId: String(central._id), rank: 2 },
      { teamId: String(north._id), rank: 3 },
    ]);
  });

  test("rejects project claims from non-municipality roles", async () => {
    const stamp = Date.now();
    const user = await User.create({
      displayName: "Broker Tester",
      email: `broker-${stamp}@example.test`,
      passwordHash: "not-used",
    });
    const team = await Team.create({
      name: "Broker Team",
      inviteCode: `B${String(stamp).slice(-5)}`,
      leaderUserId: String(user._id),
      members: [
        {
          userId: String(user._id),
          displayName: "Broker Tester",
          role: "broker",
          ready: true,
        },
      ],
      status: "in-room",
    });
    const game = await Game.create({
      roomId: `room-broker-${stamp}`,
      status: "active",
      startedAt: stamp,
      activeEndsAt: stamp + 120_000,
      participantTeamIds: [String(team._id)],
    });
    const template = PROJECTS[0]!;
    const state = defaultTeam(String(team._id), 1);
    (Object.keys(template.requirementsKg) as Array<keyof typeof template.requirementsKg>)
      .forEach((material) => {
        state.inventory[material].B = template.requirementsKg[material];
        state.roleInventories.municipality[material].B =
          template.requirementsKg[material];
      });
    await GameTeamState.create({
      gameId: String(game._id),
      teamId: String(team._id),
      ...state,
      memberRoles: { broker: String(user._id) },
    });
    const project = await GameProject.create({
      gameId: String(game._id),
      sequence: 1,
      templateId: template.id,
      template,
      status: "active",
      activeAt: stamp,
      expiresAt: stamp + 120_000,
    });
    const app = createApp(env);
    const token = signToken({ userId: String(user._id), roles: ["student"] }, env);
    const response = await request(app)
      .post(`/v1/games/${game._id}/projects/${project._id}/claim`)
      .set("authorization", `Bearer ${token}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000011")
      .send({
        commandId: "00000000-0000-4000-8000-000000000011",
        expectedTeamRevision: 0,
        payload: { confirm: true },
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ROLE_NOT_AUTHORIZED");
  });

  test("persists multiplier receipt on direct project claim", async () => {
    const stamp = Date.now() + 1;
    const user = await User.create({
      displayName: "Municipality Tester",
      email: `municipality-${stamp}@example.test`,
      passwordHash: "not-used",
    });
    const team = await Team.create({
      name: "Municipality Team",
      inviteCode: `M${String(stamp).slice(-5)}`,
      leaderUserId: String(user._id),
      members: [
        {
          userId: String(user._id),
          displayName: "Municipality Tester",
          role: "municipality",
          ready: true,
        },
      ],
      status: "in-room",
    });
    const game = await Game.create({
      roomId: `room-muni-${stamp}`,
      status: "active",
      startedAt: stamp,
      activeEndsAt: stamp + 180_000,
      participantTeamIds: [String(team._id)],
    });
    const template = PROJECTS[0]!;
    const state = defaultTeam(String(team._id), 1);
    state.totalCO2Kg = 1000;
    const plannedKg = Object.values(template.requirementsKg).reduce(
      (sum, value) => sum + value,
      0,
    );
    state.provenance.externalKg = plannedKg;
    (Object.keys(template.requirementsKg) as Array<keyof typeof template.requirementsKg>)
      .forEach((material) => {
        state.inventory[material].B = template.requirementsKg[material];
        state.roleInventories[
          material === "paper" || material === "metal" ? "mrf" : "broker"
        ][material].B = template.requirementsKg[material];
      });
    await GameTeamState.create({
      gameId: String(game._id),
      teamId: String(team._id),
      ...state,
      memberRoles: { municipality: String(user._id) },
    });
    const project = await GameProject.create({
      gameId: String(game._id),
      sequence: 1,
      templateId: template.id,
      template,
      status: "active",
      activeAt: stamp,
      expiresAt: stamp + 120_000,
    });

    const app = createApp(env);
    const token = signToken({ userId: String(user._id), roles: ["student"] }, env);
    const snapshot = await request(app)
      .get(`/v1/games/${game._id}/snapshot`)
      .set("authorization", `Bearer ${token}`);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.data.team.rewardMultiplierBasisPoints).toBe(10_000);

    const claimed = await request(app)
      .post(`/v1/games/${game._id}/projects/${project._id}/claim`)
      .set("authorization", `Bearer ${token}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000021")
      .send({
        commandId: "00000000-0000-4000-8000-000000000021",
        expectedTeamRevision: 0,
        payload: { confirm: true },
      });

    expect(claimed.status).toBe(200);
    expect(claimed.body.data.result.receipt.multiplierBasisPoints).toBe(10_000);
    expect(claimed.body.data.result.receipt.netRevenueCents).toBe(
      template.grossRevenueCents,
    );

    const persistedProject = await GameProject.findById(project._id).lean();
    expect(persistedProject?.awardReceipt?.multiplierBasisPoints).toBe(10_000);
    const announcement = await GameAnnouncement.findOne({
      gameId: String(game._id),
      key: `project-win:${project._id}`,
    }).lean();
    expect(announcement).toMatchObject({
      key: `project-win:${project._id}`,
      type: "project-win",
      message: `City Municipality Team completes the Project ${template.title}, gaining $3,200 revenue & -1.2 t CO2e!!`,
      payload: {
        projectId: String(project._id),
        projectTemplateId: template.id,
        winnerTeamId: String(team._id),
        winnerCity: "City Municipality Team",
        winnerCityName: "Municipality Team",
        winnerCitySlot: 1,
        projectName: template.title,
        revenueCents: template.grossRevenueCents,
        grossRevenueCents: template.grossRevenueCents,
        netRevenueCents: template.grossRevenueCents,
        multiplierBasisPoints: 10_000,
        co2ImpactKg: template.co2ImpactKg,
      },
    });
    const announcementOutbox = await OutboxEvent.findOne({
      gameId: String(game._id),
      eventType: "announcement.created",
    }).lean();
    expect(announcementOutbox).toMatchObject({
      target: `game:${game._id}`,
      payload: {
        announcement: expect.objectContaining({
          key: `project-win:${project._id}`,
          message: announcement?.message,
        }),
      },
    });
    const announcementSnapshot = await request(app)
      .get(`/v1/games/${game._id}/snapshot`)
      .set("authorization", `Bearer ${token}`);
    expect(announcementSnapshot.body.data.announcements).toEqual([
      expect.objectContaining({
        key: `project-win:${project._id}`,
        type: "project-win",
        message: announcement?.message,
      }),
    ]);
    const persistedTeam = await GameTeamState.findOne({
      gameId: String(game._id),
      teamId: String(team._id),
    }).lean();
    expect(persistedTeam?.walletCents).toBe(
      state.walletCents + template.grossRevenueCents,
    );
    expect(persistedTeam?.inventory).toEqual(defaultTeam("empty", 1).inventory);
    expect(persistedTeam?.roleInventories).toEqual(
      defaultTeam("empty", 1).roleInventories,
    );
  });

  test("allows MRF to dispatch recovered material to a teammate", async () => {
    const stamp = Date.now() + 2;
    const user = await User.create({
      displayName: "Transfer MRF",
      email: `transfer-mrf-${stamp}@example.test`,
      passwordHash: "not-used",
    });
    const team = await Team.create({
      name: "Transfer Team",
      inviteCode: `T${String(stamp).slice(-5)}`,
      leaderUserId: String(user._id),
      members: [
        {
          userId: String(user._id),
          displayName: "Transfer MRF",
          role: "mrf",
          ready: true,
        },
      ],
      status: "in-room",
    });
    const game = await Game.create({
      roomId: `room-transfer-${stamp}`,
      status: "active",
      startedAt: stamp,
      activeEndsAt: stamp + 180_000,
      participantTeamIds: [String(team._id)],
    });
    const state = defaultTeam(String(team._id), 1);
    state.inventory.metal.B = 500;
    state.roleInventories.mrf.metal.B = 500;
    await GameTeamState.create({
      gameId: String(game._id),
      teamId: String(team._id),
      ...state,
      memberRoles: { mrf: String(user._id) },
    });

    const app = createApp(env);
    const token = signToken({ userId: String(user._id), roles: ["student"] }, env);
    const response = await request(app)
      .post(`/v1/games/${game._id}/material-transfers`)
      .set("authorization", `Bearer ${token}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000031")
      .send({
        commandId: "00000000-0000-4000-8000-000000000031",
        expectedTeamRevision: 0,
        payload: {
          toRole: "broker",
          materialType: "metal",
          grade: "B",
          quantityKg: 300,
          route: "standard",
        },
      });

    expect(response.status).toBe(200);
    const transfer = await MaterialTransfer.findOne({
      gameId: String(game._id),
      commandId: "00000000-0000-4000-8000-000000000031",
    }).lean();
    expect(transfer).toMatchObject({
      fromRole: "mrf",
      toRole: "broker",
      materialType: "metal",
      grade: "B",
      quantityKg: 300,
      status: "in_transit",
    });
    const updatedState = await GameTeamState.findOne({
      gameId: String(game._id),
      teamId: String(team._id),
    }).lean();
    expect(updatedState?.roleInventories.mrf.metal.B).toBe(200);
    expect(updatedState?.inventory.metal.B).toBe(500);
  });

  test("decomposes a raw MRF batch before starting individual material recovery", async () => {
    const stamp = Date.now() + 3;
    const user = await User.create({
      displayName: "MRF Operator",
      email: `mrf-${stamp}@example.test`,
      passwordHash: "not-used",
    });
    const team = await Team.create({
      name: "MRF Team",
      inviteCode: `R${String(stamp).slice(-5)}`,
      leaderUserId: String(user._id),
      members: [
        {
          userId: String(user._id),
          displayName: "MRF Operator",
          role: "mrf",
          ready: true,
        },
      ],
      status: "in-room",
    });
    const game = await Game.create({
      roomId: `room-mrf-${stamp}`,
      status: "active",
      startedAt: stamp,
      activeEndsAt: stamp + 180_000,
      participantTeamIds: [String(team._id)],
    });
    const state = defaultTeam(String(team._id), 1);
    await GameTeamState.create({
      gameId: String(game._id),
      teamId: String(team._id),
      ...state,
      memberRoles: { mrf: String(user._id) },
    });
    const source = await WasteSource.create({
      gameId: String(game._id),
      teamId: String(team._id),
      massKg: 1_000,
      compositionKg: { paper: 600, plastic: 400, metal: 0, glass: 0, wood: 0 },
      contaminationBasisPoints: 500,
      status: "at_mrf",
      expiresAt: stamp + 60_000,
    });

    const app = createApp(env);
    const token = signToken({ userId: String(user._id), roles: ["student"] }, env);
    const directProcess = await request(app)
      .post(`/v1/games/${game._id}/mrf/processes`)
      .set("authorization", `Bearer ${token}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000041")
      .send({
        commandId: "00000000-0000-4000-8000-000000000041",
        expectedTeamRevision: 0,
        payload: {
          wasteSourceId: String(source._id),
          methodId: "paper-hydropulp-deink",
        },
      });

    expect(directProcess.status).toBe(400);
    expect(directProcess.body.error.code).toBe("WASTE_SOURCE_NOT_AVAILABLE");

    const decomposed = await request(app)
      .post(`/v1/games/${game._id}/mrf/decompositions`)
      .set("authorization", `Bearer ${token}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000042")
      .send({
        commandId: "00000000-0000-4000-8000-000000000042",
        expectedTeamRevision: 0,
        payload: { wasteSourceId: String(source._id) },
      });

    expect(decomposed.status).toBe(200);
    expect(await WasteSource.findById(source._id).lean()).toMatchObject({
      status: "decomposed",
    });
    const streams = await WasteSource.find({
      parentWasteSourceId: String(source._id),
      status: "held",
    })
      .sort({ massKg: -1 })
      .lean();
    expect(streams).toEqual([
      expect.objectContaining({ massKg: 600, compositionKg: expect.objectContaining({ paper: 600 }) }),
      expect.objectContaining({ massKg: 400, compositionKg: expect.objectContaining({ plastic: 400 }) }),
    ]);
    expect(await ProcessJob.countDocuments({ gameId: String(game._id) })).toBe(0);

    const paperStream = streams.find((stream: any) => stream.compositionKg.paper > 0)!;
    const plasticStream = streams.find((stream: any) => stream.compositionKg.plastic > 0)!;
    const [response, plasticResponse] = await Promise.all([
      request(app)
        .post(`/v1/games/${game._id}/mrf/processes`)
        .set("authorization", `Bearer ${token}`)
        .set("idempotency-key", "00000000-0000-4000-8000-000000000043")
        .send({
          commandId: "00000000-0000-4000-8000-000000000043",
          expectedTeamRevision: 1,
          payload: {
            wasteSourceId: String(paperStream._id),
            methodId: "paper-hydropulp-deink",
          },
        }),
      request(app)
        .post(`/v1/games/${game._id}/mrf/processes`)
        .set("authorization", `Bearer ${token}`)
        .set("idempotency-key", "00000000-0000-4000-8000-000000000044")
        .send({
          commandId: "00000000-0000-4000-8000-000000000044",
          expectedTeamRevision: 1,
          payload: {
            wasteSourceId: String(plasticStream._id),
            methodId: "plastic-sort-pelletize",
          },
        }),
    ]);

    expect(response.status).toBe(200);
    expect(plasticResponse.status).toBe(200);
    const job = await ProcessJob.findOne({
      gameId: String(game._id),
      wasteSourceId: String(paperStream._id),
    }).lean();
    expect(job).toMatchObject({
      methodId: "paper-hydropulp-deink",
        status: "processing",
        result: expect.objectContaining({
          grade: "A",
          outputKg: expect.objectContaining({ paper: 484 }),
        }),
      });
    expect(await WasteSource.findById(paperStream._id).lean()).toMatchObject({
      status: "processing",
    });
    expect(await WasteSource.findById(plasticStream._id).lean()).toMatchObject({
      status: "processing",
    });
    expect(await ProcessJob.countDocuments({ gameId: String(game._id) })).toBe(2);
  });

  test("reserves MRF Grade C stock in a durable quality-upgrade job", async () => {
    const stamp = Date.now() + 6;
    const user = await User.create({
      displayName: "Quality MRF",
      email: `quality-mrf-${stamp}@example.test`,
      passwordHash: "not-used",
    });
    const team = await Team.create({
      name: "Quality Team",
      inviteCode: `Q${String(stamp).slice(-5)}`,
      leaderUserId: String(user._id),
      members: [
        {
          userId: String(user._id),
          displayName: "Quality MRF",
          role: "mrf",
          ready: true,
        },
      ],
      status: "in-room",
    });
    const game = await Game.create({
      roomId: `room-quality-${stamp}`,
      status: "active",
      startedAt: stamp,
      activeEndsAt: stamp + 180_000,
      participantTeamIds: [String(team._id)],
    });
    const state = defaultTeam(String(team._id), 1);
    state.inventory.plastic.C = 1_000;
    state.roleInventories.mrf.plastic.C = 1_000;
    await GameTeamState.create({
      gameId: String(game._id),
      teamId: String(team._id),
      ...state,
      memberRoles: { mrf: String(user._id) },
    });
    const app = createApp(env);
    const token = signToken({ userId: String(user._id), roles: ["student"] }, env);
    const body = {
      commandId: "00000000-0000-4000-8000-000000000047",
      expectedTeamRevision: 0,
      payload: {
        materialType: "plastic",
        inputGrade: "C",
        targetGrade: "B",
        quantityKg: 1_000,
      },
    };
    const [first, duplicate] = await Promise.all([
      request(app)
        .post(`/v1/games/${game._id}/mrf/quality-upgrades`)
        .set("authorization", `Bearer ${token}`)
        .set("idempotency-key", body.commandId)
        .send(body),
      request(app)
        .post(`/v1/games/${game._id}/mrf/quality-upgrades`)
        .set("authorization", `Bearer ${token}`)
        .set("idempotency-key", body.commandId)
        .send(body),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(first.body.data.result.qualityUpgrade._id).toBe(
      duplicate.body.data.result.qualityUpgrade._id,
    );
    const updated = await GameTeamState.findOne({
      gameId: String(game._id),
      teamId: String(team._id),
    }).lean();
    expect(updated).toMatchObject({
      revision: 1,
      totalCO2Kg: 90,
      inventory: { plastic: { C: 0, B: 0 } },
      roleInventories: { mrf: { plastic: { C: 0, B: 0 } } },
    });
    expect(updated?.walletCents).toBe(state.walletCents - 5_000);
    expect(await QualityUpgradeJob.findOne({ gameId: String(game._id) }).lean()).toMatchObject({
      materialType: "plastic",
      inputGrade: "C",
      targetGrade: "B",
      status: "processing",
      result: expect.objectContaining({ inputKg: 1_000, outputKg: 700 }),
    });
    const snapshot = await request(app)
      .get(`/v1/games/${game._id}/snapshot`)
      .set("authorization", `Bearer ${token}`);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.data.team.activeQualityUpgrades).toEqual([
      expect.objectContaining({ materialType: "plastic", status: "processing" }),
    ]);
  });

  test("settles an accepted Broker trade immediately for both teams", async () => {
    const stamp = Date.now() + 7;
    const [offeringUser, recipientUser] = await Promise.all([
      User.create({
        displayName: "Offering Broker",
        email: `offering-broker-${stamp}@example.test`,
        passwordHash: "not-used",
      }),
      User.create({
        displayName: "Recipient Broker",
        email: `recipient-broker-${stamp}@example.test`,
        passwordHash: "not-used",
      }),
    ]);
    const [offeringTeam, recipientTeam] = await Promise.all([
      Team.create({
        name: "Metal City",
        inviteCode: `M${String(stamp).slice(-5)}`,
        leaderUserId: String(offeringUser._id),
        members: [{ userId: String(offeringUser._id), displayName: "Offering Broker", role: "broker", ready: true }],
        status: "in-room",
      }),
      Team.create({
        name: "Paper City",
        inviteCode: `P${String(stamp).slice(-5)}`,
        leaderUserId: String(recipientUser._id),
        members: [{ userId: String(recipientUser._id), displayName: "Recipient Broker", role: "broker", ready: true }],
        status: "in-room",
      }),
    ]);
    const game = await Game.create({
      roomId: `room-trade-${stamp}`,
      status: "active",
      startedAt: stamp,
      activeEndsAt: stamp + 180_000,
      participantTeamIds: [String(offeringTeam._id), String(recipientTeam._id)],
    });
    const offeringState = defaultTeam(String(offeringTeam._id), 1);
    offeringState.inventory.metal.B = 100;
    offeringState.roleInventories.broker.metal.B = 100;
    const recipientState = defaultTeam(String(recipientTeam._id), 2);
    recipientState.inventory.paper.B = 200;
    recipientState.roleInventories.broker.paper.B = 200;
    await GameTeamState.insertMany([
      { gameId: String(game._id), teamId: String(offeringTeam._id), ...offeringState, memberRoles: { broker: String(offeringUser._id) } },
      { gameId: String(game._id), teamId: String(recipientTeam._id), ...recipientState, memberRoles: { broker: String(recipientUser._id) } },
    ]);
    const app = createApp(env);
    const offeringToken = signToken({ userId: String(offeringUser._id), roles: ["student"] }, env);
    const recipientToken = signToken({ userId: String(recipientUser._id), roles: ["student"] }, env);

    const created = await request(app)
      .post(`/v1/games/${game._id}/broker/trades`)
      .set("authorization", `Bearer ${offeringToken}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000045")
      .send({
        commandId: "00000000-0000-4000-8000-000000000045",
        expectedTeamRevision: 0,
        payload: {
          recipientTeamId: String(recipientTeam._id),
          terms: {
            offered: { materials: [{ materialType: "metal", grade: "B", quantityKg: 100 }], cashCents: 0 },
            requested: { materials: [{ materialType: "paper", grade: "B", quantityKg: 200 }], cashCents: 0 },
            deliveryMode: "standard",
          },
        },
      });
    expect(created.status).toBe(200);
    const offerId = created.body.data.result.offer._id;

    const accepted = await request(app)
      .post(`/v1/games/${game._id}/broker/trades/${offerId}/accept`)
      .set("authorization", `Bearer ${recipientToken}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000046")
      .send({ commandId: "00000000-0000-4000-8000-000000000046", payload: {} });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.result.status).toBe("completed");

    expect(await TradeOffer.findById(offerId).lean()).toMatchObject({ status: "completed" });
    const [updatedOffering, updatedRecipient] = await Promise.all([
      GameTeamState.findOne({ gameId: String(game._id), teamId: String(offeringTeam._id) }).lean(),
      GameTeamState.findOne({ gameId: String(game._id), teamId: String(recipientTeam._id) }).lean(),
    ]);
    expect(updatedOffering).toMatchObject({
      inventory: expect.objectContaining({ metal: expect.objectContaining({ B: 0 }), paper: expect.objectContaining({ B: 200 }) }),
      roleInventories: expect.objectContaining({ broker: expect.objectContaining({ metal: expect.objectContaining({ B: 0 }), paper: expect.objectContaining({ B: 200 }) }) }),
    });
    expect(updatedRecipient).toMatchObject({
      inventory: expect.objectContaining({ paper: expect.objectContaining({ B: 0 }), metal: expect.objectContaining({ B: 100 }) }),
      roleInventories: expect.objectContaining({ broker: expect.objectContaining({ paper: expect.objectContaining({ B: 0 }), metal: expect.objectContaining({ B: 100 }) }) }),
    });
  });

  test("keeps snapshots readable but blocks every team command during health recovery", async () => {
    const stamp = Date.now() + 4;
    const user = await User.create({
      displayName: "Recovery Broker",
      email: `recovery-${stamp}@example.test`,
      passwordHash: "not-used",
    });
    const team = await Team.create({
      name: "Recovery Team",
      inviteCode: `H${String(stamp).slice(-5)}`,
      leaderUserId: String(user._id),
      members: [
        {
          userId: String(user._id),
          displayName: "Recovery Broker",
          role: "broker",
          ready: true,
        },
      ],
      status: "in-room",
    });
    const game = await Game.create({
      roomId: `room-recovery-${stamp}`,
      status: "active",
      startedAt: stamp,
      activeEndsAt: stamp + 180_000,
      participantTeamIds: [String(team._id)],
    });
    const state = defaultTeam(String(team._id), 1);
    state.health = 0;
    state.healthRecoveryUntil = stamp + 30_000;
    await GameTeamState.create({
      gameId: String(game._id),
      teamId: String(team._id),
      ...state,
      memberRoles: { broker: String(user._id) },
    });

    const app = createApp(env);
    const token = signToken({ userId: String(user._id), roles: ["student"] }, env);
    const snapshot = await request(app)
      .get(`/v1/games/${game._id}/snapshot`)
      .set("authorization", `Bearer ${token}`);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.data.team.healthRecoveryUntil).toBe(
      state.healthRecoveryUntil,
    );

    const blocked = await request(app)
      .post(`/v1/games/${game._id}/broker/external-purchases`)
      .set("authorization", `Bearer ${token}`)
      .set("idempotency-key", "00000000-0000-4000-8000-000000000051")
      .send({
        commandId: "00000000-0000-4000-8000-000000000051",
        expectedTeamRevision: 0,
        payload: { materialType: "paper", quantityKg: 100 },
      });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("TEAM_HEALTH_RECOVERY");
  });
});
