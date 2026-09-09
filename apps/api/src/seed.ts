import "dotenv/config";
import mongoose from "mongoose";
import { readEnv } from "./env.js";
import { User } from "./models.js";
import bcrypt from "bcryptjs";
const env = readEnv();
if (env.NODE_ENV === "production")
  throw new Error("Refusing to seed a privileged account in production.");
const password = process.env.SEED_FACILITATOR_PASSWORD;
if (!password || password.length < 12)
  throw new Error("Set SEED_FACILITATOR_PASSWORD to a strong development password.");
await mongoose.connect(env.MONGODB_URI);
const email = "facilitator@circular.city";
await User.updateOne(
  { email },
  {
    $setOnInsert: {
      displayName: "Facilitator",
      email,
       passwordHash: await bcrypt.hash(password, 12),
      roles: ["facilitator", "admin"],
    },
  },
  { upsert: true },
);
console.log(`Seeded facilitator account ${email}.`);
await mongoose.disconnect();
