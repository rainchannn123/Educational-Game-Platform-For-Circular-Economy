import { afterEach, describe, expect, test, vi } from "vitest";
import type { Env } from "../src/env.js";
import {
  completionUrl,
  generateAzureFoundryReply,
} from "../src/chatbot/provider.js";

const env: Env = {
  NODE_ENV: "test",
  API_PORT: 0,
  MONGODB_URI: "mongodb://unused",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "chatbot-provider-test-secret-that-is-long-enough",
  WEB_ORIGIN: "http://localhost:3000",
  DNS_SERVERS: ["8.8.8.8"],
  CHATBOT_ENABLED: true,
  CHATBOT_PROVIDER: "openai",
  CHATBOT_ENDPOINT: "https://seesustainopedia-gpt5-resource.services.ai.azure.com/openai/v1",
  CHATBOT_API_KEY: "test-key",
  CHATBOT_MODEL_NAME: "DeepSeek-Test",
  CHATBOT_API_PATH: "/chat/completions",
  CHATBOT_AUTH_MODE: "auto",
  CHATBOT_TIMEOUT_MS: 12_000,
  CHATBOT_MAX_TOKENS: 450,
  CHATBOT_SYSTEM_PROMPT: "",
};

afterEach(() => vi.unstubAllGlobals());

describe("Azure Foundry OpenAI-compatible provider", () => {
  test("uses the Azure OpenAI v1 completions path and api-key header", async () => {
    let capturedRequest: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = init;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Use the MRF recycle option." } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    expect(completionUrl(env)).toBe(
      "https://seesustainopedia-gpt5-resource.services.ai.azure.com/openai/v1/chat/completions",
    );
    await expect(
      generateAzureFoundryReply(env, [
        { role: "system", content: "You are a game advisor." },
        { role: "user", content: "What should I recycle?" },
      ]),
    ).resolves.toBe("Use the MRF recycle option.");

    expect(capturedRequest?.headers).toMatchObject({ "api-key": "test-key" });
    expect(JSON.parse(String(capturedRequest?.body))).toMatchObject({ model: "DeepSeek-Test" });
  });
});
