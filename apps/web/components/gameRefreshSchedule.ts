import { STANDARD_SCENARIO } from "@circular-city/game-content";
import type { GameSnapshot } from "./city/types";

export type RefreshBoundary = {
  at: number;
  reason:
    | "quiz-window"
    | "quiz-expiry"
    | "mrf-processing"
    | "mrf-quality-upgrade"
    | "raw-transport"
    | "material-transfer"
    | "trade-expiry"
    | "project-transition"
    | "game-transition";
};

const nextBoundary = (
  current: RefreshBoundary | null,
  at: number | undefined,
  reason: RefreshBoundary["reason"],
  serverNow: number,
): RefreshBoundary | null => {
  if (typeof at !== "number") return current;
  const normalizedAt = at > serverNow ? at : serverNow + 1_000;
  if (!current || normalizedAt < current.at) return { at: normalizedAt, reason };
  return current;
};

export function nextAuthoritativeRefresh(
  snapshot: GameSnapshot,
  serverNow: number,
): RefreshBoundary | null {
  let boundary: RefreshBoundary | null = null;
  const activeStartedAt = snapshot.game.activeStartedAt;
  if (snapshot.game.status === "active" && typeof activeStartedAt === "number") {
    const firstQuizAt = activeStartedAt + STANDARD_SCENARIO.firstHealthMissionMs;
    if (serverNow < firstQuizAt) {
      boundary = nextBoundary(boundary, firstQuizAt, "quiz-window", serverNow);
    } else {
      const slot = Math.floor(
        (serverNow - firstQuizAt) / STANDARD_SCENARIO.healthMissionMs,
      );
      const quizStartedAt = firstQuizAt + slot * STANDARD_SCENARIO.healthMissionMs;
      const quizEndsAt = quizStartedAt + STANDARD_SCENARIO.healthDeadlineMs;
      if (serverNow < quizEndsAt) {
        boundary = nextBoundary(
          boundary,
          snapshot.team.currentHealthMission?.expiresAt ?? serverNow + 1_000,
          snapshot.team.currentHealthMission ? "quiz-expiry" : "quiz-window",
          serverNow,
        );
      } else {
        boundary = nextBoundary(
          boundary,
          quizStartedAt + STANDARD_SCENARIO.healthMissionMs,
          "quiz-window",
          serverNow,
        );
      }
    }
  }

  for (const transport of snapshot.team.transports)
    boundary = nextBoundary(boundary, transport.arrivesAt, "raw-transport", serverNow);
  for (const transfer of snapshot.team.materialTransfers)
    boundary = nextBoundary(boundary, transfer.arrivesAt, "material-transfer", serverNow);
  for (const job of snapshot.team.activeJobs)
    boundary = nextBoundary(boundary, job.dueAt, "mrf-processing", serverNow);
  for (const upgrade of snapshot.team.activeQualityUpgrades ?? [])
    boundary = nextBoundary(
      boundary,
      upgrade.dueAt,
      "mrf-quality-upgrade",
      serverNow,
    );
  for (const trade of snapshot.trades)
    if (trade.status === "open")
      boundary = nextBoundary(boundary, trade.expiresAt, "trade-expiry", serverNow);
  for (const project of [
    ...snapshot.projects.preview,
    ...snapshot.projects.active,
    ...snapshot.projects.queued,
  ]) {
    if (project.status === "announced" || project.status === "queued")
      boundary = nextBoundary(boundary, project.activeAt, "project-transition", serverNow);
    if (project.status === "active")
      boundary = nextBoundary(boundary, project.expiresAt, "project-transition", serverNow);
  }
  boundary = nextBoundary(boundary, snapshot.game.activeEndsAt, "game-transition", serverNow);
  boundary = nextBoundary(
    boundary,
    snapshot.game.finalizationEndsAt,
    "game-transition",
    serverNow,
  );
  return boundary;
}
