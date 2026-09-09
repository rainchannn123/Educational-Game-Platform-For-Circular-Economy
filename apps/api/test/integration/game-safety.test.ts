import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { defaultTeam } from "@circular-city/game-engine";
import { signToken } from "../../src/auth.js";
import { createApp } from "../../src/app.js";
import { GameService } from "../../src/game-service.js";
import {
  ChatMessage,
  Game,
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
});
