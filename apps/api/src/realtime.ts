import type { Server } from "socket.io";

let realtimeServer: Server | null = null;

export function setRealtimeServer(server: Server): void {
  realtimeServer = server;
}

export function emitTeamUpdated(teamId: string): void {
  realtimeServer
    ?.to(`team:${teamId}`)
    .emit("team.updated", { teamId, occurredAt: Date.now() });
}
