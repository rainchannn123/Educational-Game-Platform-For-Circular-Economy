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
  GameProject,
  GameTeamState,
  Team,
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
    const [ownSnapshot, otherSnapshot] = await Promise.all([
      request(app)
        .get(`/v1/games/${game._id}/snapshot`)
        .set("authorization", `Bearer ${firstToken}`),
      request(app)
        .get(`/v1/games/${game._id}/snapshot`)
        .set("authorization", `Bearer ${secondToken}`),
    ]);

    expect(ownSnapshot.status).toBe(200);
    expect(ownSnapshot.body.data.chatMessages).toHaveLength(1);
    expect(otherSnapshot.status).toBe(200);
    expect(otherSnapshot.body.data.chatMessages).toEqual([]);

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
  });

  test("allows project claims from any role when materials are sufficient", async () => {
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

    expect(response.status).toBe(200);
    expect(response.body.data.result.receipt.netRevenueCents).toBeGreaterThan(0);
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
    const persistedTeam = await GameTeamState.findOne({
      gameId: String(game._id),
      teamId: String(team._id),
    }).lean();
    expect(persistedTeam?.walletCents).toBe(
      state.walletCents + template.grossRevenueCents,
    );
  });
});
