import { describe, expect, test } from "vitest";
import type { Server } from "socket.io";
import { emitRealtime, setRealtimeServer } from "../src/realtime.js";

describe("immediate realtime publisher", () => {
  test("emits a durable event envelope to the requested room", () => {
    const emitted: Array<{ target: string; eventType: string; event: unknown }> = [];
    const server = {
      to: (target: string) => ({
        emit: (eventType: string, event: unknown) => {
          emitted.push({ target, eventType, event });
        },
      }),
    } as unknown as Server;
    setRealtimeServer(server);

    emitRealtime("team:game:team", "chat.message.created", {
      eventId: "event-1",
      gameId: "game",
    });

    expect(emitted).toEqual([
      {
        target: "team:game:team",
        eventType: "chat.message.created",
        event: { eventId: "event-1", gameId: "game" },
      },
    ]);
    setRealtimeServer(null);
  });
});
