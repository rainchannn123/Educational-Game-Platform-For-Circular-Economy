import { MATERIAL_VALUES, type Material } from "@circular-city/contracts";
import type {
  CityProject,
  CityRenderModel,
  CityTransit,
  GameSnapshot,
} from "./types";

const routeDurationMs = {
  express: 6_000,
  standard: 10_000,
  consolidated: 16_000,
} as const;

const totalMaterialKg = (
  inventory: GameSnapshot["team"]["inventory"],
  material: Material,
): number => {
  const stock = inventory[material];
  return stock.A + stock.B + stock.C;
};

export function buildCityRenderModel(snapshot: GameSnapshot): CityRenderModel {
  const transportBySourceId = new Map(
    snapshot.team.transports.map((transport) => [
      transport.wasteSourceId,
      transport,
    ]),
  );
  const collectionTransits: CityTransit[] = snapshot.team.wasteSources
    .filter((source) => source.status === "in_transit")
    .map((source) => {
      const transport = transportBySourceId.get(source._id);
      return {
        id: source._id,
        kind: "collection",
        route: transport?.route ?? "standard",
        arrivesAt:
          transport?.arrivesAt ??
          source.transitArrivesAt ??
          snapshot.game.serverTime + routeDurationMs.standard,
      };
    });

  const tradeTransits: CityTransit[] = snapshot.trades
    .filter((trade) => trade.status === "in-transit" && trade.deliveryDueAt)
    .map((trade) => {
      const material = trade.terms.offered.materials[0]?.materialType;
      return {
        id: trade._id,
        kind: "trade" as const,
        ...(material ? { material } : {}),
        route: trade.terms.deliveryMode,
        arrivesAt: trade.deliveryDueAt!,
      };
    });

  const processingTransits: CityTransit[] = snapshot.team.activeJobs.map(
    (job) => ({
      id: job._id,
      kind: "processing",
      route: "standard",
      arrivesAt: job.dueAt,
    }),
  );

  const toProject = (
    project: GameSnapshot["projects"]["active"][number],
  ): CityProject => ({
    id: project._id,
    sequence: project.sequence,
    status: project.status,
    title: project.template.title,
    tier: project.template.tier,
    ...(project.expiresAt ? { expiresAt: project.expiresAt } : {}),
    isTeamWinner: project.winnerTeamId === snapshot.viewer.teamId,
  });

  const projects = [
    ...snapshot.projects.active,
    ...snapshot.projects.queued,
    ...snapshot.projects.preview,
    ...snapshot.projects.recentlyClosed.slice(-4),
  ]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, 6)
    .map(toProject);

  const inventoryKg = Object.fromEntries(
    MATERIAL_VALUES.map((material) => [
      material,
      totalMaterialKg(snapshot.team.inventory, material),
    ]),
  ) as Record<Material, number>;

  return {
    role: snapshot.viewer.role,
    status: snapshot.game.status,
    health: snapshot.team.health,
    inventoryKg,
    waste: {
      available: snapshot.team.wasteSources.filter(
        (source) => source.status === "available",
      ).length,
      queued: snapshot.team.wasteSources.filter((source) =>
        ["at_mrf", "held"].includes(source.status),
      ).length,
      processing: snapshot.team.activeJobs.length,
    },
    transits: [...collectionTransits, ...processingTransits, ...tradeTransits],
    projects,
    hasCityCareMission: snapshot.team.currentHealthMission !== null,
    activeTradeCount: snapshot.trades.filter((trade) =>
      ["open", "in-transit"].includes(trade.status),
    ).length,
  };
}
