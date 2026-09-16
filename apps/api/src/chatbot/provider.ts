import type { Env } from "../env.js";
import { ChatbotUnavailableError, type ChatbotMessage } from "./types.js";

type ProviderResponse = {
  choices?: Array<{
    message?: { content?: string | Array<{ text?: string }> };
  }>;
};

const completionUrl = (env: Env): string => {
  const endpoint = env.CHATBOT_ENDPOINT;
  if (!endpoint) throw new ChatbotUnavailableError();
  const path = env.CHATBOT_API_PATH;
  const url = path.startsWith("http")
    ? new URL(path)
    : new URL(`${endpoint.replace(/\/$/, "")}${path}`);
  if (env.CHATBOT_API_VERSION && !url.searchParams.has("api-version"))
    url.searchParams.set("api-version", env.CHATBOT_API_VERSION);
  return url.toString();
};

const responseText = (payload: ProviderResponse): string => {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content))
    return content
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  return "";
};

export async function generateAzureFoundryReply(
  env: Env,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<string> {
  if (
    !env.CHATBOT_ENABLED ||
    env.CHATBOT_PROVIDER !== "azure-foundry" ||
    !env.CHATBOT_API_KEY ||
    !env.CHATBOT_MODEL_NAME
  )
    throw new ChatbotUnavailableError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.CHATBOT_TIMEOUT_MS);
  try {
    const response = await fetch(completionUrl(env), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": env.CHATBOT_API_KEY,
      },
      body: JSON.stringify({
        model: env.CHATBOT_MODEL_NAME,
        messages,
        max_tokens: env.CHATBOT_MAX_TOKENS,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new ChatbotUnavailableError();
    const reply = responseText((await response.json()) as ProviderResponse);
    if (!reply) throw new ChatbotUnavailableError();
    return reply;
  } catch (error) {
    if (error instanceof ChatbotUnavailableError) throw error;
    throw new ChatbotUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

export type { ChatbotMessage };
