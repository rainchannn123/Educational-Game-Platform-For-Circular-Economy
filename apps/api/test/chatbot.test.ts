import { describe, expect, test } from "vitest";
import request from "supertest";
import { signToken } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { retrieveKnowledge } from "../src/chatbot/knowledge.js";
import {
  allowChatbotRequest,
  clearChatbotRateLimits,
} from "../src/chatbot/rate-limit.js";

const env = {
  NODE_ENV: "test" as const,
  API_PORT: 0,
  MONGODB_URI: "mongodb://unused-for-disabled-chatbot",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "chatbot-test-secret-that-is-long-enough",
  WEB_ORIGIN: "http://localhost:3000",
  DNS_SERVERS: ["8.8.8.8"],
  CHATBOT_ENABLED: false,
  CHATBOT_PROVIDER: "disabled" as const,
  CHATBOT_API_PATH: "/openai/v1/chat/completions",
  CHATBOT_TIMEOUT_MS: 12_000,
  CHATBOT_MAX_TOKENS: 450,
  CHATBOT_SYSTEM_PROMPT: "",
};

describe("chatbot safeguards", () => {
  test("retrieves gameplay context only when the question is relevant", () => {
    expect(retrieveKnowledge("How does MRF recycling compare with landfill?")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: expect.objectContaining({ id: "mrf-recycling" }) }),
      ]),
    );
    expect(retrieveKnowledge("qzxv blorp nnn")).toEqual([]);
  });

  test("limits repeated requests by key inside a fixed window", () => {
    clearChatbotRateLimits();
    expect(allowChatbotRequest("ip:test", 2, 60_000, 1_000)).toBe(true);
    expect(allowChatbotRequest("ip:test", 2, 60_000, 1_001)).toBe(true);
    expect(allowChatbotRequest("ip:test", 2, 60_000, 1_002)).toBe(false);
  });

  test("returns a generic 503 while the provider is disabled", async () => {
    const app = createApp(env as any);
    const token = signToken({ userId: "user", roles: ["student"] }, env as any);
    const response = await request(app)
      .post("/v1/games/game/chatbot/messages")
      .set("authorization", `Bearer ${token}`)
      .send({ message: "How does recycling work?" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("CHATBOT_UNAVAILABLE");
  });
});
