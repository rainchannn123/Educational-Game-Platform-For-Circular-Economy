"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Material, Role } from "@circular-city/contracts";
import { HEALTH_MISSIONS, MATERIALS } from "@circular-city/game-content";
import { api, command, getToken } from "../lib/api";
import type {
  CityFacility,
  CityTransferEffect,
  GameSnapshot,
} from "./city/types";
import styles from "./GameScreen.module.css";

const CityScene = dynamic(
  () => import("./city/CityScene").then((module) => module.CityScene),
  {
    ssr: false,
    loading: () => (
      <section className={styles.cityLoading} aria-live="polite">
        Preparing the shared circular city...
      </section>
    ),
  },
);

type Snapshot = GameSnapshot;
type ActionPanel =
  | "role"
  | "team"
  | "communication"
  | "history"
  | null;
type DeltaValue = { value: number; at: number };
type QuizFeedback = {
  missionId: string;
  status: "correct" | "wrong" | "no-response";
  delta: number;
  until: number;
};
type MetricDeltaState = {
  wallet: DeltaValue | null;
  health: DeltaValue | null;
  co2: DeltaValue | null;
  inventory: Partial<Record<Material, DeltaValue>>;
};
type RealtimeEnvelope = {
  eventId?: string;
  eventType?: string;
  payload?: Record<string, any>;
};
const apiBase = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";
const formatMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );
const formatTons = (kg: number) => `${((kg ?? 0) / 1000).toFixed(1)} t`;
const formatMultiplier = (basisPoints: number) =>
  `${(Math.max(0, basisPoints ?? 0) / 10_000).toFixed(2)}x`;
const applyMultiplierCents = (cents: number, basisPoints: number) =>
  Math.round((cents * (basisPoints ?? 0)) / 10_000);
const formatDeltaValue = (value: number, unit: "money" | "tons" | "percent") =>
  unit === "money"
    ? `${value >= 0 ? "+" : ""}${formatMoney(value)}`
    : unit === "tons"
      ? `${value >= 0 ? "+" : ""}${formatTons(value)}`
      : `${value >= 0 ? "+" : ""}${value}%`;
const asset = (name: string): string => `/assets/${name}.png`;
const materialAsset: Record<Material, string> = {
  paper: asset("paper"),
  plastic: asset("plastic"),
  metal: asset("metal"),
  glass: asset("glass"),
  wood: asset("wood"),
};
const roleAvatar: Record<Role, string> = {
  municipality: asset("municipality-avatar"),
  mrf: asset("mrf-avatar"),
  broker: asset("broker-avatar"),
};
const formatCountdown = (target: number, current: number) => {
  const seconds = Math.max(0, Math.ceil((target - current) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const materials: Material[] = ["paper", "plastic", "metal", "glass", "wood"];
const realtimeEvents = [
  "project.announced",
  "project.previewed",
  "project.activated",
  "project.claimed",
  "project.expired",
  "team.metrics.updated",
  "team.inventory.updated",
  "municipality.transport.updated",
  "mrf.processing.updated",
  "project.readiness.updated",
  "trade.offer.updated",
  "trade.delivery.updated",
  "mrf.queue.updated",
  "health-mission.created",
  "ping.created",
  "chat.message.created",
  "game.status.changed",
  "health-mission.updated",
  "game.snapshot.required",
] as const;
export function GameScreen({
  gameId,
  routeRole,
}: {
  gameId: string;
  routeRole: Role;
}) {
  const queryClient = useQueryClient();
  const [, setNotice] = useState("");
  const [chat, setChat] = useState("");
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [commandBusy, setCommandBusy] = useState(false);
  const [actionPanel, setActionPanel] = useState<ActionPanel>(null);
  const [selectedFacility, setSelectedFacility] =
    useState<CityFacility>(routeRole);
  const [transferEffects, setTransferEffects] = useState<CityTransferEffect[]>(
    [],
  );
  const [quizFeedback, setQuizFeedback] = useState<QuizFeedback | null>(null);
  const [metricDeltas, setMetricDeltas] = useState<MetricDeltaState>({
    wallet: null,
    health: null,
    co2: null,
    inventory: {},
  });
  const socketRef = useRef<Socket | null>(null);
  const sendLockRef = useRef(false);
  const recentEventIdsRef = useRef<string[]>([]);
  const transferTimeoutsRef = useRef<number[]>([]);
  const previousTeamRef = useRef<GameSnapshot["team"] | null>(null);
  const seenQuizResultMissionIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(
    () => () => {
      transferTimeoutsRef.current.forEach((timeoutId) =>
        window.clearTimeout(timeoutId),
      );
      transferTimeoutsRef.current = [];
    },
    [],
  );
  useEffect(() => {
    if (!quizFeedback || clock < quizFeedback.until) return;
    setQuizFeedback(null);
  }, [clock, quizFeedback]);
  const snapshot = useQuery({
    queryKey: ["snapshot", gameId],
    queryFn: () => api<Snapshot>(`/v1/games/${gameId}/snapshot`),
    refetchInterval: 12000,
  });

  const enqueueTransferEffect = useCallback(
    (
      kind: CityTransferEffect["kind"],
      options?: Partial<Pick<CityTransferEffect, "material" | "durationMs">>,
    ) => {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const durationMs = options?.durationMs ?? 2800;
      setTransferEffects((current) => [
        ...current.slice(-11),
        {
          id,
          kind,
          createdAt,
          durationMs,
          ...(options?.material ? { material: options.material } : {}),
        },
      ]);
      const timeoutId = window.setTimeout(() => {
        setTransferEffects((current) =>
          current.filter((effect) => effect.id !== id),
        );
        transferTimeoutsRef.current = transferTimeoutsRef.current.filter(
          (entry) => entry !== timeoutId,
        );
      }, durationMs + 220);
      transferTimeoutsRef.current.push(timeoutId);
    },
    [],
  );

  const markEventSeen = useCallback((eventId?: string): boolean => {
    if (!eventId) return true;
    if (recentEventIdsRef.current.includes(eventId)) return false;
    recentEventIdsRef.current = [...recentEventIdsRef.current.slice(-199), eventId];
    return true;
  }, []);

  const applyRealtimeVisual = useCallback(
    (eventName: string, envelope: RealtimeEnvelope) => {
      const payload = envelope.payload ?? {};
      if (eventName === "team.inventory.updated" && payload.source === "external") {
        enqueueTransferEffect("external-purchase", {
          material: payload.material as Material,
          durationMs: 2400,
        });
        return;
      }
      if (eventName === "mrf.processing.updated" && payload.status === "completed") {
        const outputKg = payload.result?.outputKg as Record<string, number> | undefined;
        const dominantMaterial = outputKg
          ? (materials
              .map((material) => ({ material, kg: outputKg[material] ?? 0 }))
              .sort((left, right) => right.kg - left.kg)[0]?.material ?? null)
          : null;
        enqueueTransferEffect("processed-material", {
          ...(dominantMaterial ? { material: dominantMaterial } : {}),
          durationMs: 3000,
        });
        return;
      }
      if (eventName === "trade.delivery.updated" && payload.status === "completed") {
        enqueueTransferEffect("trade-delivery", { durationMs: 2800 });
        return;
      }
      if (eventName === "project.claimed") {
        const viewerTeamId = snapshot.data?.viewer.teamId;
        if (!viewerTeamId || payload.winnerTeamId === viewerTeamId)
          enqueueTransferEffect("project-delivery", { durationMs: 3200 });
      }
    },
    [enqueueTransferEffect, snapshot.data?.viewer.teamId],
  );
  useEffect(() => {
    if (!snapshot.data || !socketRef.current?.connected) return;
    for (const trade of snapshot.data.trades ?? [])
      socketRef.current.emit("socket.join-trade", {
        gameId,
        tradeOfferId: trade._id,
      });
  }, [connected, gameId, snapshot.data]);
  useEffect(() => {
    const socket = io(apiBase, {
      auth: { token: getToken() },
      transports: ["websocket"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 6,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4000,
    });
    socketRef.current = socket;
    const connectIfVisible = () => {
      if (document.visibilityState === "visible" && !socket.connected)
        socket.connect();
    };
    const pauseRealtime = () => {
      if (socket.connected) socket.disconnect();
    };
    const handlePageHide = () => pauseRealtime();
    const handlePageShow = () => connectIfVisible();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") pauseRealtime();
      else connectIfVisible();
    };
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("socket.join-game", { gameId });
    });
    socket.on("disconnect", () => setConnected(false));
    const sync = () => {
      void queryClient.invalidateQueries({ queryKey: ["snapshot", gameId] });
    };
    realtimeEvents.forEach((eventName) => {
      socket.on(eventName, (envelope: RealtimeEnvelope) => {
        if (!markEventSeen(envelope?.eventId)) return;
        applyRealtimeVisual(eventName, envelope ?? {});
        sync();
      });
    });
    socket.on("connect_error", () => {
      setConnected(false);
      setNotice(
        "Reconnecting. Commands are disabled until the latest snapshot arrives.",
      );
    });
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    connectIfVisible();
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      socket.close();
    };
  }, [applyRealtimeVisual, gameId, markEventSeen, queryClient]);
  useEffect(() => {
    const closePanel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionPanel(null);
    };
    window.addEventListener("keydown", closePanel);
    return () => window.removeEventListener("keydown", closePanel);
  }, []);

  useEffect(() => {
    const team = snapshot.data?.team;
    if (!team) return;
    const previous = previousTeamRef.current;
    if (previous) {
      const nowAt = Date.now();
      const walletDelta = team.walletCents - previous.walletCents;
      const healthDelta = team.health - previous.health;
      const co2Delta = team.totalCO2Kg - previous.totalCO2Kg;
      const inventoryDelta = Object.fromEntries(
        materials
          .map((material) => {
            const currentStock = team.inventory[material];
            const previousStock = previous.inventory[material];
            const currentTotal = currentStock.A + currentStock.B + currentStock.C;
            const previousTotal =
              previousStock.A + previousStock.B + previousStock.C;
            const delta = currentTotal - previousTotal;
            return delta
              ? ([material, { value: delta, at: nowAt }] as const)
              : null;
          })
          .filter(Boolean) as Array<[Material, DeltaValue]>,
      );
      setMetricDeltas((current) => ({
        wallet: walletDelta ? { value: walletDelta, at: nowAt } : current.wallet,
        health: healthDelta ? { value: healthDelta, at: nowAt } : current.health,
        co2: co2Delta ? { value: co2Delta, at: nowAt } : current.co2,
        inventory: {
          ...current.inventory,
          ...inventoryDelta,
        },
      }));
    }
    previousTeamRef.current = team;
  }, [snapshot.data?.team.revision]);
  useEffect(() => {
    const data = snapshot.data;
    if (!data) return;
    if (data.viewer.role !== routeRole) return;
    if (data.game.status === "completed") return;
    const mission = data.team.currentHealthMission;
    const myStep = mission?.steps?.[routeRole];
    if (!mission || myStep) return;
    const serverNow =
      data.game.serverTime + Math.max(0, clock - snapshot.dataUpdatedAt);
    if (serverNow < mission.expiresAt) return;
    if (seenQuizResultMissionIdsRef.current.includes(mission._id)) return;
    seenQuizResultMissionIdsRef.current = [
      ...seenQuizResultMissionIdsRef.current.slice(-99),
      mission._id,
    ];
    setQuizFeedback({
      missionId: mission._id,
      status: "no-response",
      delta: -2,
      until: Date.now() + 5_000,
    });
  }, [clock, routeRole, snapshot.data, snapshot.dataUpdatedAt]);
  if (snapshot.isLoading)
    return (
      <main className="page">
        <p>Synchronizing city control room...</p>
      </main>
    );
  if (snapshot.isError)
    return (
      <main className="page">
        <p role="alert">Unable to load this game. {snapshot.error.message}</p>
      </main>
    );
  const data = snapshot.data!;
  if (data.viewer.role !== routeRole)
    return (
      <main className="page">
        <h1>Role workstation mismatch</h1>
        <p>
          Your selected role is {data.viewer.role}. Open the matching
          workstation to make authoritative commands.
        </p>
      </main>
    );
  if (data.game.status === "completed")
    return (
      <main className="page">
        <section className="card">
          <p className={styles.eyebrow}>MATCH COMPLETE</p>
          <h1>The city round has finished</h1>
          <p>
            Final rankings are fixed. Review material flow, wallet outcomes, and
            City Care decisions in the facilitated debrief.
          </p>
          <Link href={`/games/${gameId}/results`}>
            Open results and reflection
          </Link>
        </section>
      </main>
    );
  const team = data.team;
  const displayServerTime =
    data.game.serverTime + Math.max(0, clock - snapshot.dataUpdatedAt);
  const rewardMultiplierBasisPoints = team.rewardMultiplierBasisPoints ?? 10_000;
  const freshDelta = (delta: DeltaValue | null | undefined) =>
    delta && clock - delta.at <= 6000 ? delta : null;
  const walletDelta = freshDelta(metricDeltas.wallet);
  const healthDelta = freshDelta(metricDeltas.health);
  const co2Delta = freshDelta(metricDeltas.co2);
  const inventoryDeltas = Object.fromEntries(
    materials
      .map((material) => {
        const delta = freshDelta(metricDeltas.inventory[material]);
        return delta ? ([material, delta] as const) : null;
      })
      .filter(Boolean) as Array<[Material, DeltaValue]>,
  ) as Partial<Record<Material, DeltaValue>>;
  const activeMission = team.currentHealthMission;
  const myMissionStep = activeMission?.steps?.[routeRole];
  const activeQuizFeedback =
    quizFeedback && clock < quizFeedback.until ? quizFeedback : null;
  const showQuizFeedback = Boolean(
    activeQuizFeedback &&
      (!activeMission || activeQuizFeedback.missionId === activeMission._id),
  );
  const showQuizQuestion = Boolean(activeMission && !myMissionStep && !showQuizFeedback);
  const showQuizBox = showQuizFeedback || showQuizQuestion;
  const send = async (
    path: string,
    payload: object,
    method = "POST",
  ): Promise<boolean> => {
    if (sendLockRef.current || commandBusy) {
      setNotice(
        "Previous action still processing. Please wait for confirmation.",
      );
      return false;
    }
    sendLockRef.current = true;
    setCommandBusy(true);
    setNotice("Submitting action...");
    try {
      const execute = async (retryOnStale: boolean): Promise<boolean> => {
        try {
          const authoritativeSnapshot = await queryClient.fetchQuery({
            queryKey: ["snapshot", gameId],
            queryFn: () => api<Snapshot>(`/v1/games/${gameId}/snapshot`),
          });

          if (authoritativeSnapshot.game.status === "completed") {
            setNotice(
              "This match has finished. Open the results screen for the debrief.",
            );
            return false;
          }
          const isProjectClaimAction = /\/projects\/[^/]+\/claim$/.test(path);
          const isCommunicationAction = /\/(chat\/messages|pings)$/.test(path);
          const isQuizAction = /\/health-missions\/[^/]+\/steps$/.test(path);
          const projectPathMatch = path.match(/\/projects\/([^/]+)\//);
          const projectId = projectPathMatch?.[1] ?? null;
          if (
            authoritativeSnapshot.game.status !== "active" &&
            !(
              authoritativeSnapshot.game.status === "finalizing" &&
              (isProjectClaimAction || isCommunicationAction || isQuizAction)
            )
          ) {
            setNotice(
              authoritativeSnapshot.game.status === "finalizing"
                ? "Finalization only accepts project completion, quiz responses, and team communication."
                : "The match is still in briefing. Actions unlock when play begins.",
            );
            return false;
          }

          if (projectId && isProjectClaimAction) {
            const project = [
              ...(authoritativeSnapshot.projects.active ?? []),
              ...(authoritativeSnapshot.projects.queued ?? []),
              ...(authoritativeSnapshot.projects.preview ?? []),
              ...(authoritativeSnapshot.projects.recentlyClosed ?? []),
            ].find((candidate: any) => candidate._id === projectId);
            if (!project || project.status !== "active") {
              setNotice(
                "This listing is no longer active. Syncing latest project rail.",
              );
              await queryClient.invalidateQueries({
                queryKey: ["snapshot", gameId],
              });
              return false;
            }
          }

          const commandPayload =
            "expectedTeamRevision" in payload
              ? {
                  ...payload,
                  expectedTeamRevision: authoritativeSnapshot.team.revision,
                }
              : payload;

          if (method === "PUT") {
            const id = crypto.randomUUID();
            await api(path, {
              method,
              headers: { "idempotency-key": id },
              body: JSON.stringify({ commandId: id, ...commandPayload }),
            });
          } else await command(path, commandPayload);
          setNotice("Command accepted. The city state is updating.");
          await queryClient.invalidateQueries({
            queryKey: ["snapshot", gameId],
          });
          return true;
        } catch (error) {
          const errorCode =
            typeof error === "object" &&
            error &&
            "code" in error &&
            typeof (error as { code?: unknown }).code === "string"
              ? ((error as { code: string }).code as string)
              : "";
          if (retryOnStale && errorCode === "STALE_TEAM_REVISION") {
            await queryClient.invalidateQueries({
              queryKey: ["snapshot", gameId],
            });
            return execute(false);
          }
          setNotice(
            error instanceof Error
              ? error.message
              : "Command could not be completed.",
          );
          return false;
        }
      };
      return await execute(true);
    } finally {
      sendLockRef.current = false;
      setCommandBusy(false);
    }
  };
  const teamLabelById = new Map<string, string>(
    (data.publicLeaderboard ?? []).map((entry: any): [string, string] => [
      String(entry.teamId),
      `City ${entry.citySlot}${entry.name ? ` (${entry.name})` : ""}`,
    ]),
  );
  const workspaceTitle =
    routeRole === "mrf"
      ? "Materials Recovery Facility"
      : routeRole === "broker"
        ? "Circular Exchange"
        : "Municipal Operations";
  const roleLabel =
    routeRole === "mrf"
      ? "MRF"
      : routeRole === "broker"
        ? "Broker"
        : "Municipality";
  const countdownTarget =
    data.game.status === "finalizing"
      ? data.game.finalizationEndsAt
      : data.game.activeEndsAt;
  const focusCityFacility = (facility: CityFacility) => {
    setSelectedFacility(facility);
    if (facility === "warehouse") {
      setActionPanel("team");
      setNotice("Shared warehouse opened.");
      return;
    }
    if (facility === "future-site") {
      setActionPanel(null);
      setNotice("Future City Site is closed this round.");
      return;
    }
    if (facility === routeRole) {
      setActionPanel("role");
      setNotice(`${workspaceTitle} controls opened.`);
      return;
    }
    setActionPanel("communication");
    setNotice(
      `${facility === "mrf" ? "MRF" : facility === "broker" ? "Broker" : "Municipality"} is operated by your teammate. Send them a contextual ping.`,
    );
  };
  const panelTitle =
    actionPanel === "role"
      ? workspaceTitle
      : actionPanel === "team"
        ? "Shared Warehouse"
        : actionPanel === "communication"
          ? "Team Communication"
          : "Project History";
  return (
    <main className={styles.gameShell} data-role={routeRole}>
      <CityScene
        effects={transferEffects}
        onSelectFacility={focusCityFacility}
        selectedFacility={selectedFacility}
        snapshot={data}
      />
      <header className={styles.header}>
        <div className={styles.metrics}>
          <Metric
            label="Wallet"
            value={formatMoney(team.walletCents)}
            delta={walletDelta}
            deltaFormatter={(value) => formatDeltaValue(value, "money")}
            icon="wallet"
          />
          <Metric
            label="City Health"
            value={`${team.health}%`}
            delta={healthDelta}
            deltaFormatter={(value) => formatDeltaValue(value, "percent")}
            tone={
              team.health < 20
                ? "danger"
                : team.health <= 50
                  ? "urgent"
                  : "stable"
            }
            icon="health"
          />
          <Metric
            label="CO2"
            value={formatTons(team.totalCO2Kg)}
            delta={co2Delta}
            deltaFormatter={(value) => formatDeltaValue(value, "tons")}
            icon="co2"
          />
          <Metric
            label="Reward"
            value={formatMultiplier(rewardMultiplierBasisPoints)}
            icon="leaf-sparkle"
          />
          <Metric
            label="Link"
            value={connected ? "Connected" : "Syncing"}
            icon="circular-economy-loop"
          />
        </div>
        <div className={styles.matchStatus} aria-label="Match status">
            <img
            className={styles.roleAvatar}
            src={roleAvatar[routeRole]}
            alt=""
          />
          <span className={styles.playerRole}>          
            {roleLabel}</span>
          <strong>
            <img className={styles.timerIcon} src={asset("countdown")} alt="" />
            {countdownTarget
              ? formatCountdown(countdownTarget, displayServerTime)
              : "--:--"}
          </strong>
        </div>
      </header>
      <section
        className={styles.projectRail}
        id="project-rail"
        aria-label="Projects"
        tabIndex={-1}
      >
        <div className={styles.rail}>
          {data.projects.active.map((project: any) => (
              <article
                className={styles.project}
                key={project._id}
                data-state={project.status}
              >
              <img
                className={styles.projectBadge}
                src={asset("badge")}
                alt=""
              />
              {project.sequence === 1 && (
                <img
                  className={styles.openingProject}
                  src={asset("one")}
                  alt="Opening project"
                />
              )}
              <p className={styles.projectMeta}>
                Tier {project.template.tier}
              </p>
              <h3>{project.template.title}</h3>
              <div className={styles.requirements}>
                {materials
                  .filter(
                    (material) => project.template.requirementsKg[material],
                  )
                  .map((material) => (
                    <span key={material}>
                      <img src={materialAsset[material]} alt="" />
                      {material}:{" "}
                      {formatTons(project.template.requirementsKg[material])}
                    </span>
                  ))}
              </div>
              <p className={styles.projectImpact}>
                <span className={styles.projectImpactStat}>
                  <img src={asset("wallet")} alt="" />
                  {formatMoney(
                    applyMultiplierCents(
                      project.template.grossRevenueCents,
                      rewardMultiplierBasisPoints,
                    ),
                  )}
                </span>
                <span className={styles.projectImpactStat}>
                  <img src={asset("co2")} alt="" />
                  {project.template.co2ImpactKg >= 0 ? "+" : "-"}
                  {formatTons(Math.abs(project.template.co2ImpactKg))}
                </span>
              </p>
              <p data-state="urgent">
                <img
                  className={styles.sparkle}
                  src={asset("leaf-sparkle")}
                  alt=""
                />
                {project.expiresAt
                  ? `${formatCountdown(project.expiresAt, displayServerTime)} remaining`
                  : "Limited-time listing"}
              </p>
              <button
                className={styles.projectClaim}
                disabled={commandBusy}
                onClick={() =>
                  void send(`/v1/games/${gameId}/projects/${project._id}/claim`, {
                    expectedTeamRevision: team.revision,
                    payload: { confirm: true },
                  })
                }
              >
                {commandBusy ? "Submitting..." : "Complete Project"}
              </button>
              </article>
          ))}
        </div>
      </section>
      <InventoryBelt deltas={inventoryDeltas} team={team} />
      <nav className={styles.actionLauncher} aria-label="Game action panels">
        <button
          aria-pressed={actionPanel === "role"}
          data-attention={hasRoleAction(team, data.trades, routeRole)}
          onClick={() => {
            setSelectedFacility(routeRole);
            setActionPanel(actionPanel === "role" ? null : "role");
          }}
          type="button"
        >
          <img src={roleAvatar[routeRole]} alt="" />
          {roleLabel} actions
        </button>
        <button
          aria-pressed={actionPanel === "team"}
          data-attention={materials.some((material) => {
            const stock = team.inventory[material];
            return stock.A + stock.B + stock.C > 0;
          })}
          onClick={() => {
            setSelectedFacility("warehouse");
            setActionPanel(actionPanel === "team" ? null : "team");
          }}
          type="button"
        >
          Warehouse
        </button>
        <button
          aria-pressed={actionPanel === "communication"}
          onClick={() =>
            setActionPanel(
              actionPanel === "communication" ? null : "communication",
            )
          }
          type="button"
        >
          Team comms
        </button>
        <button
          aria-pressed={actionPanel === "history"}
          onClick={() =>
            setActionPanel(actionPanel === "history" ? null : "history")
          }
          type="button"
        >
          History
        </button>
      </nav>
      {actionPanel && (
        <aside
          aria-label={panelTitle}
          className={styles.actionPopup}
          role="dialog"
        >
          <header className={styles.actionPopupHeader}>
            <div>
              <span>TEAM CITY CONTROL</span>
              <h2>{panelTitle}</h2>
            </div>
            <button
              aria-label={`Close ${panelTitle}`}
              className={styles.closePopup}
              onClick={() => setActionPanel(null)}
              type="button"
            >
              ×
            </button>
          </header>
          <div className={styles.actionPopupBody}>
            {actionPanel === "role" && routeRole === "municipality" && (
              <Municipality
                team={team}
                gameId={gameId}
                send={send}
                busy={commandBusy}
                currentTime={displayServerTime}
              />
            )}
            {actionPanel === "role" && routeRole === "mrf" && (
              <Mrf
                team={team}
                gameId={gameId}
                send={send}
                busy={commandBusy}
                currentTime={displayServerTime}
              />
            )}
            {actionPanel === "role" && routeRole === "broker" && (
              <Broker
                team={team}
                gameId={gameId}
                teams={data.publicLeaderboard}
                trades={data.trades}
                send={send}
                busy={commandBusy}
                currentTime={displayServerTime}
              />
            )}
            {actionPanel === "team" && (
              <WarehouseOperations
                team={team}
              />
            )}
            {actionPanel === "communication" && (
              <Communication
                gameId={gameId}
                chat={chat}
                setChat={setChat}
                send={send}
                busy={commandBusy}
                messages={data.chatMessages ?? []}
              />
            )}
            {actionPanel === "history" && (
              <ProjectHistoryNotes
                projects={data.projects.recentlyClosed}
                teamLabelById={teamLabelById}
              />
            )}
          </div>
        </aside>
      )}
      {showQuizBox && (
        <aside className={styles.quizBox} aria-label="Role quiz" role="region">
          <RoleQuizPrompt
            busy={commandBusy}
            currentTime={displayServerTime}
            feedback={activeQuizFeedback}
            gameId={gameId}
            mission={activeMission}
            onAnswerResult={(result) => {
              seenQuizResultMissionIdsRef.current = [
                ...seenQuizResultMissionIdsRef.current.slice(-99),
                result.missionId,
              ];
              setQuizFeedback({
                ...result,
                until: Date.now() + 5_000,
              });
            }}
            role={routeRole}
            send={send}
          />
        </aside>
      )}
    </main>
  );
}
function Metric({
  label,
  value,
  tone,
  icon,
  delta,
  deltaFormatter,
}: {
  label: string;
  value: string;
  tone?: string;
  icon: string;
  delta?: DeltaValue | null;
  deltaFormatter?: (value: number) => string;
}) {
  return (
    <div data-state={tone}>
      <img className={styles.metricIcon} src={asset(icon)} alt="" />
      <span>{label}</span>
      <strong>{value}</strong>
      {delta && deltaFormatter && (
        <em
          className={styles.metricDelta}
          data-direction={delta.value >= 0 ? "up" : "down"}
          key={`${label}-${delta.at}`}
        >
          {deltaFormatter(delta.value)}
        </em>
      )}
    </div>
  );
}

function hasRoleAction(
  team: GameSnapshot["team"],
  trades: GameSnapshot["trades"],
  role: Role,
): boolean {
  if (role === "municipality")
    return team.wasteSources.some((source) => source.status === "available");
  if (role === "mrf")
    return team.wasteSources.some((source) =>
      ["at_mrf", "held"].includes(source.status),
    );
  return trades.some(
    (trade) => trade.status === "open" && trade.recipientTeamId === team.teamId,
  );
}

function InventoryBelt({
  team,
  deltas,
}: {
  team: GameSnapshot["team"];
  deltas: Partial<Record<Material, DeltaValue>>;
}) {
  return (
    <section className={styles.inventoryBelt} aria-label="Shared inventory">
      <span className={styles.inventoryBeltTitle}>Shared stock</span>
      {materials.map((material) => {
        const stock = team.inventory[material];
        const total = stock.A + stock.B + stock.C;
        const delta = deltas[material];
        return (
          <div key={material} title={`${material}: ${formatTons(total)} total`}>
            <img src={materialAsset[material]} alt="" />
            <span>{material}</span>
            <strong>{formatTons(total)}</strong>
            {delta && (
              <em
                className={styles.inventoryDelta}
                data-direction={delta.value >= 0 ? "up" : "down"}
                key={`${material}-${delta.at}`}
              >
                {delta.value >= 0 ? "+" : ""}
                {formatTons(delta.value)}
              </em>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Municipality({
  team,
  gameId,
  send,
  busy,
  currentTime,
}: {
  team: any;
  gameId: string;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
}) {
  const availableSources = team.wasteSources.filter(
    (source: any) => source.status === "available",
  );
  const transitSources = team.wasteSources.filter(
    (source: any) => source.status === "in_transit",
  );
  const transportBySourceId = new Map<
    string,
    { arrivesAt?: number; route?: "express" | "standard" | "consolidated" }
  >(
    (team.transports ?? []).map((transport: any) => [
      String(transport.wasteSourceId),
      {
        arrivesAt: transport.arrivesAt,
        route: transport.route,
      },
    ]),
  );
  return (
    <>
      <div className={styles.queue}>
        {transitSources.map((source: any) => {
          const sourceTransport = transportBySourceId.get(String(source._id));
          return (
            <article key={source._id}>
              <strong className={styles.batchTitle}>
                <img src={asset("material-bale")} alt="" />
                {formatTons(source.massKg)} waste batch in transit
              </strong>
              <span>
                <img
                  className={styles.timerIcon}
                  src={asset("countdown")}
                  alt=""
                />
                Delivering to MRF in{" "}
                {(sourceTransport?.arrivesAt ?? source.transitArrivesAt)
                  ? formatCountdown(
                      sourceTransport?.arrivesAt ?? source.transitArrivesAt,
                      currentTime,
                    )
                  : "0:00"}
              </span>
              <span>
                Route: {(sourceTransport?.route ?? "standard").replace("-", " ")}
              </span>
              <span className="muted">
                Batch is locked until arrival at MRF queue.
              </span>
            </article>
          );
        })}
        {availableSources.map((source: any) => (
          <article key={source._id}>
            <strong className={styles.batchTitle}>
              <img src={asset("material-bale")} alt="" />
              {formatTons(source.massKg)} waste batch
            </strong>
            <span>
              Contamination {(source.contaminationBasisPoints / 100).toFixed(0)}
              %
            </span>
            <span>
              Expires in {formatCountdown(source.expiresAt, currentTime)}
            </span>
            <span>
              Expected mix:{" "}
              {materials
                .filter((material) => source.compositionKg?.[material])
                .map(
                  (material) =>
                    `${material} ${formatTons(source.compositionKg[material])}`,
                )
                .join(" · ")}
            </span>
            <div>
              <button
                disabled={busy}
                onClick={() =>
                  void send(`/v1/games/${gameId}/municipality/collections`, {
                    expectedTeamRevision: team.revision,
                    payload: { wasteSourceId: source._id, route: "express" },
                  })
                }
              >
                Express: 6s · $0.07/kg · 0.36 CO2/kg
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void send(`/v1/games/${gameId}/municipality/collections`, {
                    expectedTeamRevision: team.revision,
                    payload: { wasteSourceId: source._id, route: "standard" },
                  })
                }
              >
                Standard: 10s · $0.045/kg · 0.18 CO2/kg
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void send(`/v1/games/${gameId}/municipality/collections`, {
                    expectedTeamRevision: team.revision,
                    payload: {
                      wasteSourceId: source._id,
                      route: "consolidated",
                    },
                  })
                }
              >
                Consolidated: 16s · $0.028/kg · 0.10 CO2/kg
              </button>
            </div>
          </article>
        ))}
        {availableSources.length === 0 && (
          <p className="muted">No collection opportunities available.</p>
        )}
      </div>
    </>
  );
}
function Mrf({
  team,
  gameId,
  send,
  busy,
  currentTime,
}: {
  team: any;
  gameId: string;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
}) {
  const guideBySource = team.mrfActionGuide ?? {};
  return (
    <>
      <div className={styles.queue}>
        {team.wasteSources
          .filter((source: any) => ["at_mrf", "held"].includes(source.status))
          .map((source: any) => (
            <article key={source._id}>
              <strong className={styles.batchTitle}>
                <img src={asset("material-bale")} alt="" />
                {formatTons(source.massKg)} MRF queue batch
              </strong>
              <span>
                Contamination{" "}
                {(source.contaminationBasisPoints / 100).toFixed(0)}%
              </span>
              {source.status === "held" && source.holdExpiresAt && (
                <span>
                  Hold expires in {formatCountdown(source.holdExpiresAt, currentTime)}
                </span>
              )}
              <div>
                {["rapid", "balanced", "quality", "hold", "landfill"].map(
                  (mode) => (
                    <button
                      key={mode}
                      disabled={busy}
                      onClick={() =>
                        void send(`/v1/games/${gameId}/mrf/processes`, {
                          expectedTeamRevision: team.revision,
                          payload: { wasteSourceId: source._id, mode },
                        })
                      }
                    >
                      {mode === "rapid"
                        ? "Rapid: 6s · lower yield"
                        : mode === "balanced"
                          ? "Balanced: 10s · reliable"
                          : mode === "quality"
                            ? "Quality: 14s · best grade"
                            : mode === "hold"
                              ? "Hold: preserve for 30s"
                              : "Landfill: 4s · health risk"}
                    </button>
                  ),
                )}
              </div>
              <div className={styles.mrfGuide}>
                <h4>Action impact preview</h4>
                {(guideBySource[source._id] ?? []).map((guide: any) => (
                  <p key={`${source._id}-${guide.mode}`}>
                    <strong>{String(guide.mode).toUpperCase()}</strong> ·{" "}
                    {Math.floor((guide.durationMs ?? 0) / 1000)}s · cost{" "}
                    {formatMoney(guide.totalCostCents ?? 0)} · CO2{" "}
                    {formatTons(guide.totalCO2Kg ?? 0)} · recover{" "}
                    {formatTons(guide.recoveredKg ?? 0)} (
                    {((guide.recoveryRateBasisPoints ?? 0) / 100).toFixed(1)}%)
                    · residue {formatTons(guide.residueKg ?? 0)}
                    {guide.grade ? ` · grade ${guide.grade}` : ""}
                    {typeof guide.healthDelta === "number"
                      ? ` · health ${guide.healthDelta >= 0 ? "+" : ""}${guide.healthDelta}`
                      : ""}
                  </p>
                ))}
              </div>
            </article>
          ))}
        {team.activeJobs.map((job: any) => (
          <p key={job._id}>
            Processing completes in {formatCountdown(job.dueAt, currentTime)}.
          </p>
        ))}
      </div>
    </>
  );
}
function Broker({
  team,
  gameId,
  teams,
  trades,
  send,
  busy,
  currentTime,
}: {
  team: any;
  gameId: string;
  teams: { teamId: string; citySlot: number; name?: string }[];
  trades: unknown[] | undefined;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
}) {
  const [tab, setTab] = useState<"trade" | "external">("trade");
  const [material, setMaterial] = useState<Material>("metal");
  const [quantity, setQuantity] = useState(1000);
  const [requestedMaterial, setRequestedMaterial] = useState<Material>("paper");
  const [recipientTeamId, setRecipientTeamId] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"standard" | "low-carbon">(
    "standard",
  );

  const recipientTeams = teams.filter(
    (candidate) => candidate.teamId !== team.teamId,
  );
  const externalCostCents =
    quantity * MATERIALS[material].externalPriceCentsPerKg;
  const externalCo2Kg = Math.round(
    (quantity * MATERIALS[material].externalCO2MilliKgPerKg) / 1000,
  );
  const availableOfferKg = Math.max(
    0,
    team.inventory[material].B - (team.inventory[material].lockedB ?? 0),
  );
  const validQuantity =
    Number.isFinite(quantity) && quantity >= 100 && quantity % 100 === 0;
  const orderedTrades = [...(trades ?? [])].sort(
    (left: any, right: any) =>
      (right.deliveryDueAt ?? right.expiresAt ?? 0) -
      (left.deliveryDueAt ?? left.expiresAt ?? 0),
  );

  return (
    <section className={styles.overlaySection}>
      <div className={styles.brokerTabs} role="tablist" aria-label="Broker actions">
        <button
          aria-selected={tab === "trade"}
          role="tab"
          type="button"
          onClick={() => setTab("trade")}
        >
          Team trade
        </button>
        <button
          aria-selected={tab === "external"}
          role="tab"
          type="button"
          onClick={() => setTab("external")}
        >
          External market
        </button>
      </div>

      {tab === "external" && (
        <div className={styles.purchase}>
          <label>
            Material
            <select
              value={material}
              onChange={(event) => setMaterial(event.target.value as Material)}
            >
              {materials.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity kg
            <input
              type="number"
              min="100"
              max="10000"
              step="100"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>
          <button
            disabled={busy || !validQuantity}
            onClick={() =>
              void send(`/v1/games/${gameId}/broker/external-purchases`, {
                expectedTeamRevision: team.revision,
                payload: { materialType: material, quantityKg: quantity },
              })
            }
          >
            Purchase {formatTons(quantity)} for {formatMoney(externalCostCents)} ·
            +{formatTons(externalCo2Kg)} CO2e
          </button>
        </div>
      )}

      {tab === "trade" && (
        <section className={styles.tradeBoard} aria-label="Broker trade board">
          <div>
            <h3>Propose a team trade</h3>
          </div>
          <label>
            Recipient city
            <select
              value={recipientTeamId}
              onChange={(event) => setRecipientTeamId(event.target.value)}
            >
              <option value="">Choose a city</option>
              {recipientTeams.map((candidate) => (
                <option key={candidate.teamId} value={candidate.teamId}>
                  City {candidate.citySlot}
                  {candidate.name ? ` (${candidate.name})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Delivery method
            <select
              value={deliveryMode}
              onChange={(event) =>
                setDeliveryMode(event.target.value as "standard" | "low-carbon")
              }
            >
              <option value="standard">Standard: 8s · $40 · 0.35 tCO2e</option>
              <option value="low-carbon">
                Low carbon: 15s · $25 · 0.15 tCO2e
              </option>
            </select>
          </label>
          <label>
            You offer
            <select
              value={material}
              onChange={(event) => setMaterial(event.target.value as Material)}
            >
              {materials.map((item) => (
                <option value={item} key={item}>
                  {item} grade B
                </option>
              ))}
            </select>
          </label>
          <label>
            You request
            <select
              value={requestedMaterial}
              onChange={(event) =>
                setRequestedMaterial(event.target.value as Material)
              }
            >
              {materials.map((item) => (
                <option value={item} key={item}>
                  {item} minimum grade B
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={
              busy ||
              !recipientTeamId ||
              !validQuantity ||
              availableOfferKg < quantity
            }
            onClick={() =>
              void send(`/v1/games/${gameId}/broker/trades`, {
                expectedTeamRevision: team.revision,
                payload: {
                  recipientTeamId,
                  terms: {
                    offered: {
                      materials: [
                        {
                          materialType: material,
                          grade: "B",
                          quantityKg: quantity,
                        },
                      ],
                      cashCents: 0,
                    },
                    requested: {
                      materials: [
                        {
                          materialType: requestedMaterial,
                          minimumGrade: "B",
                          quantityKg: quantity,
                        },
                      ],
                      cashCents: 0,
                    },
                    deliveryMode,
                  },
                },
              })
            }
          >
            Send trade offer
          </button>
          {recipientTeamId && availableOfferKg < quantity && (
            <p className="muted">
              You need {formatTons(quantity - availableOfferKg)} more grade B {material}
              to make this offer.
            </p>
          )}
          <div className={styles.tradeList}>
            {orderedTrades.map((offer: any) => {
              const incoming = offer.recipientTeamId === team.teamId;
              const offered = offer.terms.offered.materials[0];
              const requested = offer.terms.requested.materials[0];
              const etaTarget =
                offer.status === "in-transit"
                  ? offer.deliveryDueAt
                  : offer.status === "open"
                    ? offer.expiresAt
                    : undefined;
              return (
                <article key={offer._id}>
                  <strong>{incoming ? "Incoming offer" : "Your offer"}</strong>
                  <span>
                    {formatTons(offered.quantityKg)} {offered.materialType} for{" "}
                    {formatTons(requested.quantityKg)} {requested.materialType}
                  </span>
                  <span>{offer.status}</span>
                  {etaTarget && (
                    <span className="muted">
                      {offer.status === "in-transit" ? "ETA" : "Expires"}: {" "}
                      {formatCountdown(etaTarget, currentTime)}
                    </span>
                  )}
                  {offer.status === "open" && incoming && (
                    <div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void send(
                            `/v1/games/${gameId}/broker/trades/${offer._id}/accept`,
                            {
                              payload: {},
                            },
                          )
                        }
                      >
                        Accept
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void send(
                            `/v1/games/${gameId}/broker/trades/${offer._id}/reject`,
                            {
                              payload: {},
                            },
                          )
                        }
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {offer.status === "open" && !incoming && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void send(
                          `/v1/games/${gameId}/broker/trades/${offer._id}/cancel`,
                          {
                            payload: {},
                          },
                        )
                      }
                    >
                      Cancel offer
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}

function ProjectHistoryNotes({
  projects,
  teamLabelById,
}: {
  projects: any[];
  teamLabelById: Map<string, string>;
}) {
  const recent = [...(projects ?? [])]
    .sort(
      (left, right) =>
        (right.claimedAt ?? right.expiresAt ?? right.updatedAt ?? 0) -
        (left.claimedAt ?? left.expiresAt ?? left.updatedAt ?? 0),
    )
    .slice(0, 12);
  return (
    <section className={styles.historyNotes}>
      <h2>Project history notes</h2>
      <ul className={styles.historyList}>
        {recent.length ? (
          recent.map((project) => {
            const winner = project.winnerTeamId
              ? (teamLabelById.get(String(project.winnerTeamId)) ??
                "Unknown city")
              : "No winning city";
            const netRevenue =
              project.awardReceipt?.netRevenueCents ??
              project.template?.grossRevenueCents;
            const multiplierLabel =
              typeof project.awardReceipt?.multiplierBasisPoints === "number"
                ? formatMultiplier(project.awardReceipt.multiplierBasisPoints)
                : null;
            return (
              <li key={project._id} className={styles.historyItem}>
                <strong>
                  {project.template.title} ({project.status})
                </strong>
                <span>
                  {project.status === "claimed"
                    ? `${winner} completed it · net ${formatMoney(netRevenue)}${multiplierLabel ? ` (${multiplierLabel})` : ""} · CO2 ${project.template.co2ImpactKg < 0 ? "avoids" : "adds"} ${formatTons(Math.abs(project.template.co2ImpactKg))}`
                    : project.status === "expired"
                      ? "Listing expired without a winner"
                      : "Listing was cancelled by facilitator/system"}
                </span>
              </li>
            );
          })
        ) : (
          <li className={styles.historyItem}>
            <strong>No closed listings yet.</strong>
            <span>
              Claimed and expired projects will appear here as short audit
              notes.
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}
function WarehouseOperations({ team }: { team: any }) {
  return (
    <section className={styles.overlaySection}>
      <h2>Shared Warehouse</h2>
      <p className="muted">
        All roles use the same stock. Grade B is the default trade material and
        projects consume eligible stock from B then A.
      </p>
      <dl className={styles.inventory}>
        {materials.map((material) => {
          const stock = team.inventory[material];
          return (
            <div key={material}>
              <dt>
                <img src={materialAsset[material]} alt="" />
                {material}
              </dt>
              <dd>
                A {formatTons(stock.A)} · B {formatTons(stock.B)} · C{" "}
                {formatTons(stock.C)}
                {stock.lockedKg
                  ? ` · locked ${formatTons(stock.lockedKg)}`
                  : ""}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function RoleQuizPrompt({
  mission,
  feedback,
  onAnswerResult,
  gameId,
  role,
  send,
  busy,
  currentTime,
}: {
  mission: GameSnapshot["team"]["currentHealthMission"];
  feedback: QuizFeedback | null;
            onAnswerResult: (result: Omit<QuizFeedback, "until">) => void;
  gameId: string;
  role: Role;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
}) {
  const missionTemplate = mission
    ? HEALTH_MISSIONS.find((template) => template.id === mission.templateId)
    : undefined;
  const myStep = mission?.steps?.[role];
  const question =
    missionTemplate?.questions?.[role] ??
    "Choose the best circular-economy action for your role.";
  const secondsRemaining = mission
    ? Math.max(0, Math.ceil((mission.expiresAt - currentTime) / 1000))
    : 0;

  return (
    <section className={styles.quizContent}>
      <h2>Role Quiz</h2>
      {feedback ? (
        <>
          <p
            className={styles.quizResult}
            data-state={feedback.status === "correct" ? "correct" : "wrong"}
          >
            {feedback.status === "correct"
              ? "Correct"
              : feedback.status === "no-response"
                ? "No Response"
                : "Wrong"}
          </p>
          <p
            className={styles.quizResultDelta}
            data-state={feedback.delta >= 0 ? "gain" : "loss"}
          >
            {feedback.delta >= 0 ? "+" : ""}
            {feedback.delta} health
          </p>
        </>
      ) : mission ? (
        <>
          <p className={styles.quizTitle}>{missionTemplate?.title ?? mission.templateId}</p>
          <p className={styles.quizQuestion}>{question}</p>
          <p className={styles.quizTimer}>{secondsRemaining}s left</p>
          {!myStep ? (
            <div className={styles.missionChoices}>
              {missionTemplate?.options?.[role]?.map((option) => (
                <button
                  key={option.key}
                  disabled={busy}
                  onClick={async () => {
                    const accepted = await send(
                      `/v1/games/${gameId}/health-missions/${mission._id}/steps`,
                      { payload: { optionKey: option.key } },
                    );
                    if (!accepted) return;
                    onAnswerResult({
                      missionId: mission._id,
                      status: option.appropriate ? "correct" : "wrong",
                      delta: option.appropriate ? 3 : -2,
                    });
                  }}
                >
                  {option.label}
                </button>
              ))}
              {!missionTemplate?.options?.[role]?.length && (
                <p className={styles.quizState}>Options synchronizing...</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
function Communication({
  gameId,
  chat,
  setChat,
  send,
  busy,
  messages,
}: {
  gameId: string;
  chat: string;
  setChat: (value: string) => void;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  messages: Array<{
    _id: string;
    senderRole: string;
    content: string;
    createdAtMs: number;
  }>;
}) {
  return (
    <section className={styles.overlaySection}>
      <h2>Team communication</h2>
      <div className={styles.pings}>
        {[
          "need-material",
          "batch-dispatched",
          "material-ready",
          "please-certify",
          "project-ready",
          "health-urgent",
        ].map((type) => (
          <button
            key={type}
            disabled={busy}
            onClick={() =>
              void send(`/v1/games/${gameId}/pings`, { payload: { type } })
            }
          >
            {type.replace("-", " ")}
          </button>
        ))}
      </div>
      <label className="srOnly" htmlFor="team-chat">
        Team message
      </label>
      <textarea
        id="team-chat"
        value={chat}
        maxLength={500}
        onChange={(event) => setChat(event.target.value)}
        placeholder="Send a concise team message"
      />
      <div
        className={styles.chatHistory}
        aria-live="polite"
        aria-label="Team messages"
      >
        {messages.length ? (
          messages.map((message) => (
            <p key={message._id}>
              <strong>{message.senderRole}</strong>{" "}
              <span>{message.content}</span>
            </p>
          ))
        ) : (
          <p className="muted">
            No messages yet. Use pings for quick hand-offs.
          </p>
        )}
      </div>
      <button
        disabled={busy || !chat.trim()}
        onClick={() => {
          void send(`/v1/games/${gameId}/chat/messages`, {
            payload: { channel: "team", message: chat },
          });
          setChat("");
        }}
      >
        Send team chat
      </button>
    </section>
  );
}
