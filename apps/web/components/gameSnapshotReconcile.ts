import type { GameSnapshot } from "./city/types";

type Identified = { _id: string };

function mergeById<T extends Identified>(
  current: T[],
  incoming: T[],
  limit: number,
  timestamp?: (entry: T) => number,
): T[] {
  const merged = new Map<string, T>();
  for (const entry of current) merged.set(entry._id, entry);
  for (const entry of incoming) merged.set(entry._id, entry);
  const entries = [...merged.values()];
  if (timestamp) entries.sort((left, right) => timestamp(left) - timestamp(right));
  return entries.slice(-limit);
}

export function reconcileGameSnapshot(
  current: GameSnapshot | undefined,
  incoming: GameSnapshot,
): GameSnapshot {
  if (!current) return incoming;

  const incomingTeamIsNewer = incoming.team.revision > current.team.revision;
  const incomingGameIsNewer = incoming.game.revision > current.game.revision;
  const team = incomingTeamIsNewer ? incoming.team : current.team;
  const game = incomingGameIsNewer ? incoming.game : current.game;

  return {
    ...incoming,
    game,
    team,
    teamProjectWork: incomingTeamIsNewer
      ? incoming.teamProjectWork
      : current.teamProjectWork,
    projects: incomingGameIsNewer ? incoming.projects : current.projects,
    publicLeaderboard: incomingGameIsNewer
      ? incoming.publicLeaderboard
      : current.publicLeaderboard,
    trades: incomingGameIsNewer ? incoming.trades : current.trades,
    announcements: mergeById(
      current.announcements,
      incoming.announcements,
      50,
      (entry) => entry.createdAtMs,
    ),
    chatMessages: mergeById(
      current.chatMessages,
      incoming.chatMessages,
      50,
      (entry) => entry.createdAtMs,
    ),
    globalChatMessages: mergeById(
      current.globalChatMessages,
      incoming.globalChatMessages,
      100,
      (entry) => entry.createdAtMs,
    ),
  };
}

export function monotonicServerTime(
  previous: number,
  candidate: number,
  allowRebase: boolean,
): number {
  if (allowRebase || previous <= 0) return candidate;
  return Math.max(previous, candidate);
}
