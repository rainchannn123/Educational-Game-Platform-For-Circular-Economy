import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../..", ".env"),
});
const dnsServersSchema = z
  .string()
  .default("8.8.8.8,8.8.4.4")
  .transform((value) =>
    value
      .split(",")
      .map((server) => server.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().ip()).min(1));
const optionalEnvString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalEnvUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DNS_SERVERS: dnsServersSchema,
  CHATBOT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CHATBOT_PROVIDER: z
    .enum(["disabled", "openai", "azure-foundry"])
    .default("disabled"),
  CHATBOT_ENDPOINT: optionalEnvUrl,
  CHATBOT_API_KEY: optionalEnvString,
  CHATBOT_MODEL_NAME: optionalEnvString,
  MODEL_NAME: optionalEnvString,
  CHATBOT_API_PATH: z.string().min(1).default("/chat/completions"),
  CHATBOT_AUTH_MODE: z
    .enum(["auto", "api-key", "bearer"])
    .default("auto"),
  CHATBOT_API_VERSION: optionalEnvString,
  CHATBOT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(12_000),
  CHATBOT_MAX_TOKENS: z.coerce.number().int().min(64).max(1_000).default(450),
  CHATBOT_SYSTEM_PROMPT: z.string().max(4_000).default(""),
});
export type Env = z.infer<typeof schema>;
export const readEnv = (): Env => schema.parse(process.env);
