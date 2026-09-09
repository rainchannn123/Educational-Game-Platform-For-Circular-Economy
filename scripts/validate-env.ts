import "dotenv/config";

const required = ["MONGODB_URI", "REDIS_URL", "JWT_SECRET"] as const;
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing required environment values: ${missing.join(", ")}`);
  process.exitCode = 1;
} else if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
  console.error("JWT_SECRET must be at least 32 characters.");
  process.exitCode = 1;
} else {
  console.log("Environment validation passed.");
}
