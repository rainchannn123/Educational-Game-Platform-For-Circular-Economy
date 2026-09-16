import "dotenv/config";
import { createServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { createApp } from "./app.js";
import { connectMongo } from "./database.js";
import { readEnv } from "./env.js";
import { GameTeamState, Team, TradeOffer } from "./models.js";
import { setRealtimeServer } from "./realtime.js";

const env = readEnv();
await connectMongo(env);
const app = createApp(env);
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: env.WEB_ORIGIN },
  connectionStateRecovery: { maxDisconnectionDuration: 120_000 },
});
setRealtimeServer(io);
const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const sub = pub.duplicate();
pub.on("error", (error) =>
  console.error("Redis publisher unavailable; retrying", error.message),
);
sub.on("error", (error) =>
  console.error("Redis subscriber unavailable; retrying", error.message),
);
io.adapter(createAdapter(pub, sub));
io.use((socket, next) => {
  try {
    const payload = jwt.verify(
      String(socket.handshake.auth.token ?? ""),
      env.JWT_SECRET,
    ) as jwt.JwtPayload;
    socket.data.principal = {
      userId: String(payload.sub),
      roles: payload.roles ?? [],
    };
    next();
  } catch {
    next(new Error("unauthenticated"));
  }
});
io.on("connection", (socket) => {
  socket.on("socket.join-team", async ({ teamId }: { teamId: string }) => {
    try {
      const principal = socket.data.principal as {
        userId: string;
        roles: string[];
      };
      const team = await Team.exists({
        _id: teamId,
        "members.userId": principal.userId,
      });

      if (team) {
        socket.join(`team:${teamId}`);
      }
    } catch (error) {
      console.error("Unable to join team socket room", error);
    }
  });

  socket.on("socket.join-game", async ({ gameId }: { gameId: string }) => {
    try {
      const principal = socket.data.principal as {
        userId: string;
        roles: string[];
      };
      const state = await GameTeamState.findOne({
        gameId,
        $expr: {
          $in: [
            principal.userId,
            {
              $map: {
                input: { $objectToArray: "$memberRoles" },
                as: "member",
                in: "$$member.v",
              },
            },
          ],
        },
      }).lean();
      if (!state) return;
      socket.join(`game:${gameId}`);
      socket.join(`team:${gameId}:${state.teamId}`);
      const trades = await TradeOffer.find({
        gameId,
        $or: [
          { offeringTeamId: state.teamId },
          { recipientTeamId: state.teamId },
        ],
      })
        .select("_id")
        .lean();
      for (const trade of trades)
        socket.join(`trade:${gameId}:${String(trade._id)}`);
      socket.emit("presence.updated", {
        gameId,
        connected: true,
        serverTime: Date.now(),
      });
    } catch (error) {
      console.error("Unable to join game socket room", error);
      socket.emit("game.snapshot.required", { gameId });
    }
  });
  socket.on("socket.leave-game", ({ gameId }: { gameId: string }) =>
    socket.leave(`game:${gameId}`),
  );
  socket.on(
    "socket.join-trade",
    async ({ gameId, tradeOfferId }: { gameId: string; tradeOfferId: string }) => {
      try {
        const principal = socket.data.principal as { userId: string };
        const state = await GameTeamState.findOne({
          gameId,
          $expr: {
            $in: [
              principal.userId,
              {
                $map: {
                  input: { $objectToArray: "$memberRoles" },
                  as: "member",
                  in: "$$member.v",
                },
              },
            ],
          },
        }).lean();
        const trade = state
          ? await TradeOffer.exists({
              _id: tradeOfferId,
              gameId,
              $or: [
                { offeringTeamId: state.teamId },
                { recipientTeamId: state.teamId },
              ],
            })
          : null;
        if (trade) socket.join(`trade:${gameId}:${tradeOfferId}`);
      } catch (error) {
        console.error("Unable to join trade socket room", error);
      }
    },
  );
});
server.listen(env.API_PORT, () =>
  console.log(`Clash of the Cities- Mission Net Zero API listening on :${env.API_PORT}`),
);
