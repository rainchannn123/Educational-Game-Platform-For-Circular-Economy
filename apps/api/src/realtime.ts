import type { Server } from "socket.io";

let realtimeServer: Server | null = null;

export function setRealtimeServer(server: Server | null): void {
  realtimeServer = server;
}

export function emitTeamUpdated(teamId: string): void {
  realtimeServer
    ?.to(`team:${teamId}`)
    .emit("team.updated", { teamId, occurredAt: Date.now() });
}

export function emitRealtime(
  target: string,
  eventType: string,
  event: Record<string, unknown>,
): void {
  realtimeServer?.to(target).emit(eventType, event);
}
