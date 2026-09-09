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
  CHATBOT_PROVIDER: z
    .enum(["disabled", "openai", "openai-compatible"])
    .default("disabled"),
  CHATBOT_ENDPOINT: z.string().url().optional(),
  CHATBOT_API_KEY: z.string().optional(),
});
export type Env = z.infer<typeof schema>;
export const readEnv = (): Env => schema.parse(process.env);
