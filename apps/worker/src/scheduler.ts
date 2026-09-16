import { HEALTH_MISSIONS, PROJECTS } from "@circular-city/game-content";

const seeded = (seed: number, cursor: number): number =>
  ((seed * 1103515245 + cursor * 12345) >>> 0) % 10000;

export function projectForSequence(seed: number, sequence: number) {
  const selected: (typeof PROJECTS)[number][] = [];
  for (let current = 1; current <= sequence; current += 1) {
    const preferred =
      current === 1
        ? PROJECTS.filter((project) => project.id === "P01" || project.id === "P02")
        : current <= 6
          ? PROJECTS.filter((project) => project.tier <= 2)
          : current <= 16
            ? PROJECTS.filter((project) => project.tier === 2 || project.tier === 3)
            : current <= 25
              ? PROJECTS.filter((project) => project.tier === 3 || project.tier === 4)
              : PROJECTS.filter((project) => project.tier >= 4);
    const unusedPreferred = preferred.filter(
      (project) => !selected.some((picked) => picked.id === project.id),
    );
    const unused = PROJECTS.filter(
      (project) => !selected.some((picked) => picked.id === project.id),
    );
    const choices = unusedPreferred.length
      ? unusedPreferred
      : unused.length
        ? unused
        : preferred;
    selected.push(choices[seeded(seed, current * 97) % choices.length]!);
  }
  return selected.at(-1)!;
}

export function dueScheduleSlots(
  lastProcessedSlot: number,
  elapsedMs: number,
  firstDueMs: number,
  intervalMs: number,
): number[] {
  if (elapsedMs < firstDueMs) return [];
  const latestSlot = Math.floor((elapsedMs - firstDueMs) / intervalMs);
  return Array.from(
    { length: Math.max(0, latestSlot - lastProcessedSlot) },
    (_, index) => lastProcessedSlot + index + 1,
  );
}

export function wasteSpawnIntervalMs(
  seed: number,
  citySlot: number,
  sequence: number,
  minimumMs: number,
  maximumMs: number,
): number {
  if (minimumMs > maximumMs) throw new Error("Invalid waste spawn interval");
  return (
    minimumMs +
    (seeded(seed, citySlot * 509 + sequence * 313) %
      (maximumMs - minimumMs + 1))
  );
}

export function healthMissionForSlot(
  seed: number,
  citySlot: number,
  missionSlot: number,
) {
  const deckSize = HEALTH_MISSIONS.length;
  const cycle = Math.floor(missionSlot / deckSize);
  const deck = Array.from({ length: deckSize }, (_, index) => index);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex =
      seeded(seed + cycle * 97, citySlot * 131 + index * 53) % (index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex]!, deck[index]!];
  }
  return HEALTH_MISSIONS[deck[missionSlot % deckSize]!]!;
}

export const timeAnnouncementMilestones = [
  { remainingMs: 15 * 60_000, message: "15 minutes remaining!" },
  { remainingMs: 10 * 60_000, message: "10 minutes remaining!" },
  { remainingMs: 5 * 60_000, message: "5 minutes left!" },
  { remainingMs: 60_000, message: "Last 1 minute!" },
] as const;

export function dueTimeAnnouncements(
  activeEndsAt: number,
  current: number,
): readonly (typeof timeAnnouncementMilestones)[number][] {
  if (current >= activeEndsAt) return [];
  const remainingMs = activeEndsAt - current;
  return timeAnnouncementMilestones.filter(
    (milestone) => remainingMs <= milestone.remainingMs,
  );
}
