import dns from "node:dns";
import mongoose from "mongoose";
import type { Env } from "./env.js";

export async function connectMongo(env: Env): Promise<void> {
  // MongoDB Atlas SRV records use Node's resolver rather than the browser or client DNS.
  dns.setServers(env.DNS_SERVERS);
  console.info(`MongoDB DNS resolvers: ${dns.getServers().join(", ")}`);
  await mongoose.connect(env.MONGODB_URI);
}
