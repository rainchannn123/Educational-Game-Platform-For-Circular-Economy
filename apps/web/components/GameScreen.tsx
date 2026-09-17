"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  Grade,
  Material,
  ProcessingMethodId,
  Role,
  Route,
} from "@circular-city/contracts";
import {
  HEALTH_MISSIONS,
  MATERIALS,
  QUALITY_UPGRADE,
} from "@circular-city/game-content";
import { api, command, getToken } from "../lib/api";
import { applyRealtimeSnapshotPatch } from "./gameSnapshotCache";
import { MarkdownText } from "./MarkdownText";
import { nextAuthoritativeRefresh } from "./gameRefreshSchedule";
import { applyCommandReceiptPatch } from "./gameCommandReceiptCache";
import { monotonicServerTime, reconcileGameSnapshot } from "./gameSnapshotReconcile";
import { hasProjectMaterials, projectMaterialEligibility } from "./projectEligibility";
import type {
  CityFacility,
  CityTransferEffect,
  GameProject,
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
const formatTransportCountdown = (target: number, current: number) => {
  const seconds = Math.max(0, Math.ceil((target - current) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
};
const materials: Material[] = ["paper", "plastic", "metal", "glass", "wood"];
const grades: Grade[] = ["A", "B", "C"];
const materialColors: Record<Material, string> = {
  paper: "#e4b14d",
  plastic: "#36c8d4",
  metal: "#90b8ec",
  glass: "#72d6a9",
  wood: "#df9660",
};
const transferRoutes: Array<{
  route: Route;
  label: string;
  detail: string;
  time: string;
  price: string;
  co2: string;
}> = [
  {
    route: "express",
    label: "Express",
    detail: "6s · $0.07/kg · 0.36 CO2/kg",
    time: "00:06",
    price: "$0.07/kg",
    co2: "0.36/kg",
  },
  {
    route: "standard",
    label: "Standard",
    detail: "10s · $0.045/kg · 0.18 CO2/kg",
    time: "00:10",
    price: "$0.045/kg",
    co2: "0.18/kg",
  },
  {
    route: "consolidated",
    label: "Consolidated",
    detail: "16s · $0.028/kg · 0.10 CO2/kg",
    time: "00:16",
    price: "$0.028/kg",
    co2: "0.10/kg",
  },
];
const realtimeEvents = [
  "project.announced",
  "project.previewed",
  "project.activated",
  "project.claimed",
  "project.expired",
  "announcement.created",
  "team.metrics.updated",
  "leaderboard.updated",
  "mrf.decomposition.updated",
  "team.health.recovery.started",
  "team.health.recovery.completed",
  "team.inventory.updated",
  "municipality.transport.updated",
  "mrf.processing.updated",
  "mrf.quality-upgrade.updated",
  "material.transfer.updated",
  "project.readiness.updated",
  "trade.offer.updated",
  "trade.delivery.updated",
  "mrf.queue.updated",
  "health-mission.created",
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
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const pendingCommandKeysRef = useRef(new Set<string>());
  const [actionPanel, setActionPanel] = useState<ActionPanel>(null);
  const [selectedFacility, setSelectedFacility] =
    useState<CityFacility>(routeRole);
  const [transferEffects, setTransferEffects] = useState<CityTransferEffect[]>(
    [],
  );
  const [quizFeedback, setQuizFeedback] = useState<QuizFeedback | null>(null);
  const [tradeNotice, setTradeNotice] = useState<
    { tone: "accepted" | "declined"; text: string } | null
  >(null);
  const [brokerPurchaseNotice, setBrokerPurchaseNotice] = useState<
    { material: Material; quantityKg: number } | null
  >(null);
  const [projectReview, setProjectReview] = useState<GameProject | null>(null);
  const [metricDeltas, setMetricDeltas] = useState<MetricDeltaState>({
    wallet: null,
    health: null,
    co2: null,
    inventory: {},
  });
  const socketRef = useRef<Socket | null>(null);
  const recentEventIdsRef = useRef<string[]>([]);
  const transferTimeoutsRef = useRef<number[]>([]);
  const snapshotSyncTimeoutRef = useRef<number | null>(null);
  const snapshotRefreshInFlightRef = useRef(false);
  const snapshotRefreshQueuedRef = useRef(false);
  const monotonicServerTimeRef = useRef(0);
  const allowClockRebaseRef = useRef(true);
  const viewerTeamIdRef = useRef<string | null>(null);
  const teamLabelByIdRef = useRef(new Map<string, string>());
  const tradeNoticeTimeoutRef = useRef<number | null>(null);
  const brokerPurchaseNoticeTimeoutRef = useRef<number | null>(null);
  const previousTeamRef = useRef<GameSnapshot["team"] | null>(null);
  const seenQuizResultMissionIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    monotonicServerTimeRef.current = 0;
    allowClockRebaseRef.current = true;
  }, [gameId]);
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
    queryFn: async () => {
      const incoming = await api<Snapshot>(`/v1/games/${gameId}/snapshot`);
      return reconcileGameSnapshot(
        queryClient.getQueryData<Snapshot>(["snapshot", gameId]),
        incoming,
      );
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    allowClockRebaseRef.current = true;
  }, [snapshot.data?.game.status]);
  const refreshSnapshot = useCallback(async (): Promise<Snapshot | undefined> => {
    if (snapshotRefreshInFlightRef.current) {
      snapshotRefreshQueuedRef.current = true;
      return queryClient.getQueryData<Snapshot>(["snapshot", gameId]);
    }
    snapshotRefreshInFlightRef.current = true;
    try {
      const incoming = await api<Snapshot>(`/v1/games/${gameId}/snapshot`);
      const current = queryClient.getQueryData<Snapshot>(["snapshot", gameId]);
      const reconciled = reconcileGameSnapshot(current, incoming);
      queryClient.setQueryData(["snapshot", gameId], reconciled);
      return reconciled;
    } finally {
      snapshotRefreshInFlightRef.current = false;
      if (snapshotRefreshQueuedRef.current) {
        snapshotRefreshQueuedRef.current = false;
        window.setTimeout(() => void refreshSnapshot(), 0);
      }
    }
  }, [gameId, queryClient]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshSnapshot();
    }, connected ? 30_000 : 12_000);
    return () => window.clearInterval(interval);
  }, [connected, refreshSnapshot]);
  useEffect(() => {
    viewerTeamIdRef.current = snapshot.data?.viewer.teamId ?? null;
  }, [snapshot.data?.viewer.teamId]);
  const leaderboard = useQuery({
    queryKey: ["leaderboard", gameId],
    queryFn: () =>
      api<GameSnapshot["publicLeaderboard"]>(`/v1/games/${gameId}/leaderboard`),
    enabled: Boolean(snapshot.data),
    initialData: snapshot.data?.publicLeaderboard,
    initialDataUpdatedAt: snapshot.dataUpdatedAt,
    refetchInterval: connected ? 60_000 : 20_000,
  });
  useEffect(() => {
    const entries = leaderboard.data ?? snapshot.data?.publicLeaderboard ?? [];
    teamLabelByIdRef.current = new Map(
      entries.map((entry) => [
        String(entry.teamId),
        `City ${entry.citySlot}${entry.name ? ` (${entry.name})` : ""}`,
      ]),
    );
  }, [leaderboard.data, snapshot.data?.publicLeaderboard]);
  useEffect(() => {
    if (!snapshot.data) return;
    queryClient.setQueryData(
      ["leaderboard", gameId],
      snapshot.data.publicLeaderboard,
    );
  }, [gameId, queryClient, snapshot.data]);
  const scheduleSnapshotSync = useCallback(() => {
    if (snapshotSyncTimeoutRef.current !== null) return;
    snapshotSyncTimeoutRef.current = window.setTimeout(() => {
      snapshotSyncTimeoutRef.current = null;
      void refreshSnapshot();
    }, 200);
  }, [refreshSnapshot]);
  useEffect(
    () => () => {
      if (snapshotSyncTimeoutRef.current !== null)
        window.clearTimeout(snapshotSyncTimeoutRef.current);
    },
    [],
  );
  useEffect(
    () => () => {
      if (tradeNoticeTimeoutRef.current !== null)
        window.clearTimeout(tradeNoticeTimeoutRef.current);
    },
    [],
  );
  useEffect(
    () => () => {
      if (brokerPurchaseNoticeTimeoutRef.current !== null)
        window.clearTimeout(brokerPurchaseNoticeTimeoutRef.current);
    },
    [],
  );
  const confirmBrokerPurchase = useCallback(
    (material: Material, quantityKg: number) => {
      setBrokerPurchaseNotice({ material, quantityKg });
      if (brokerPurchaseNoticeTimeoutRef.current !== null)
        window.clearTimeout(brokerPurchaseNoticeTimeoutRef.current);
      brokerPurchaseNoticeTimeoutRef.current = window.setTimeout(() => {
        brokerPurchaseNoticeTimeoutRef.current = null;
        setBrokerPurchaseNotice(null);
      }, 5_000);
    },
    [],
  );

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
      if (
        eventName === "mrf.quality-upgrade.updated" &&
        payload.status === "completed"
      ) {
        enqueueTransferEffect("processed-material", {
          material: payload.materialType as Material,
          durationMs: 2600,
        });
        return;
      }
      if (eventName === "trade.delivery.updated" && payload.status === "completed") {
        enqueueTransferEffect("trade-delivery", { durationMs: 2800 });
        return;
      }
      if (eventName === "trade.offer.updated") {
        const offer = payload.offer as any;
        const viewerTeamId = viewerTeamIdRef.current;
        if (
          offer?.offeringTeamId === viewerTeamId &&
          ["completed", "rejected"].includes(offer.status)
        ) {
          const requested = offer.terms?.requested?.materials?.[0];
          const respondingCity =
            teamLabelByIdRef.current.get(String(offer.recipientTeamId)) ??
            "The recipient city";
          const accepted = offer.status === "completed";
          setTradeNotice({
            tone: accepted ? "accepted" : "declined",
            text: accepted
              ? `${respondingCity} accepted your request for ${formatTons(requested?.quantityKg ?? 0)} ${requested?.materialType ?? "material"}.`
              : `${respondingCity} declined your trade request for ${formatTons(requested?.quantityKg ?? 0)} ${requested?.materialType ?? "material"}.`,
          });
          if (tradeNoticeTimeoutRef.current !== null)
            window.clearTimeout(tradeNoticeTimeoutRef.current);
          tradeNoticeTimeoutRef.current = window.setTimeout(() => {
            tradeNoticeTimeoutRef.current = null;
            setTradeNotice(null);
          }, 6_000);
        }
      }
      if (
        eventName === "material.transfer.updated" &&
        payload.status === "completed"
      ) {
        enqueueTransferEffect("processed-material", {
          material: payload.material as Material,
          durationMs: 2600,
        });
        return;
      }
      if (eventName === "project.claimed") {
        const viewerTeamId = viewerTeamIdRef.current;
        if (!viewerTeamId || payload.winnerTeamId === viewerTeamId)
          enqueueTransferEffect("project-delivery", { durationMs: 3200 });
      }
    },
    [enqueueTransferEffect],
  );
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
    let connectTimeout: number | null = null;
    const connectIfVisible = () => {
      if (document.visibilityState !== "visible" || socket.connected) return;
      if (connectTimeout !== null) window.clearTimeout(connectTimeout);
      // Avoid a development Strict Mode mount/cleanup cycle opening a socket it immediately closes.
      connectTimeout = window.setTimeout(() => {
        connectTimeout = null;
        if (document.visibilityState === "visible" && !socket.connected)
          socket.connect();
      }, 50);
    };
    const pauseRealtime = () => {
      if (connectTimeout !== null) {
        window.clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      if (socket.connected) socket.disconnect();
    };
    const handlePageHide = () => pauseRealtime();
    const handlePageShow = () => {
      allowClockRebaseRef.current = true;
      connectIfVisible();
      void refreshSnapshot();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") pauseRealtime();
      else {
        allowClockRebaseRef.current = true;
        connectIfVisible();
        void refreshSnapshot();
      }
    };
    socket.on("connect", () => {
      allowClockRebaseRef.current = true;
      setConnected(true);
      socket.emit("socket.join-game", { gameId });
    });
    socket.on("disconnect", () => setConnected(false));
    realtimeEvents.forEach((eventName) => {
      socket.on(eventName, (envelope: RealtimeEnvelope) => {
        if (!markEventSeen(envelope?.eventId)) return;
        applyRealtimeVisual(eventName, envelope ?? {});
        if (eventName === "leaderboard.updated") {
          void queryClient.invalidateQueries({ queryKey: ["leaderboard", gameId] });
          return;
        }
        const current = queryClient.getQueryData<GameSnapshot>([
          "snapshot",
          gameId,
        ]);
        const patched = current
          ? applyRealtimeSnapshotPatch(current, eventName, envelope.payload ?? {})
          : null;
        if (patched) {
          queryClient.setQueryData(["snapshot", gameId], patched);
          if (eventName.startsWith("trade.")) scheduleSnapshotSync();
          return;
        }
        scheduleSnapshotSync();
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
      if (connectTimeout !== null) window.clearTimeout(connectTimeout);
      socket.close();
    };
  }, [applyRealtimeVisual, gameId, markEventSeen, queryClient, refreshSnapshot, scheduleSnapshotSync]);
  useEffect(() => {
    const closePanel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !projectReview) setActionPanel(null);
    };
    window.addEventListener("keydown", closePanel);
    return () => window.removeEventListener("keydown", closePanel);
  }, [projectReview]);

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
  useEffect(() => {
    const data = snapshot.data;
    if (!data) return;
    const serverNow =
      data.game.serverTime + Math.max(0, Date.now() - snapshot.dataUpdatedAt);
    const recovering =
      data.team.health <= 0 ||
      (typeof data.team.healthRecoveryUntil === "number" &&
        data.team.healthRecoveryUntil > serverNow);
    if (!recovering) return;
    const refreshIn =
      typeof data.team.healthRecoveryUntil === "number" &&
      data.team.healthRecoveryUntil > serverNow
        ? data.team.healthRecoveryUntil - serverNow + 250
        : 3_000;
    const refresh = window.setTimeout(() => {
      if (document.visibilityState === "visible")
        void refreshSnapshot();
    }, refreshIn);
    return () => window.clearTimeout(refresh);
  }, [refreshSnapshot, snapshot.data, snapshot.dataUpdatedAt]);
  useEffect(() => {
    const data = snapshot.data;
    if (!data) return;
    const serverNow =
      data.game.serverTime + Math.max(0, Date.now() - snapshot.dataUpdatedAt);
    const boundary = nextAuthoritativeRefresh(data, serverNow);
    if (!boundary) return;
    const clientJitter =
      [...data.viewer.userId].reduce((sum, character) => sum + character.charCodeAt(0), 0) %
      250;
    // Wait just over one worker tick and stagger clients slightly to avoid a refresh herd.
    const refreshIn = Math.max(300, boundary.at - serverNow + 1_100 + clientJitter);
    const refresh = window.setTimeout(() => {
      if (document.visibilityState === "visible")
        void refreshSnapshot();
    }, refreshIn);
    return () => window.clearTimeout(refresh);
  }, [refreshSnapshot, snapshot.data, snapshot.dataUpdatedAt]);
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
  const candidateServerTime =
    data.game.serverTime + Math.max(0, clock - snapshot.dataUpdatedAt);
  const displayServerTime = monotonicServerTime(
    monotonicServerTimeRef.current,
    candidateServerTime,
    allowClockRebaseRef.current,
  );
  monotonicServerTimeRef.current = displayServerTime;
  allowClockRebaseRef.current = false;
  const recoveryRemaining = team.healthRecoveryUntil
    ? Math.max(0, team.healthRecoveryUntil - displayServerTime)
    : 0;
  const teamHealthRecovering =
    typeof team.healthRecoveryUntil === "number"
      ? recoveryRemaining > 0
      : team.health <= 0;
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
    const commandKey = `${method}:${path}:${JSON.stringify(payload)}`;
    if (pendingCommandKeysRef.current.has(commandKey)) {
      setNotice("This action is already being submitted.");
      return false;
    }
    pendingCommandKeysRef.current.add(commandKey);
    setNotice("Submitting action...");
    try {
      const execute = async (retryOnStale: boolean): Promise<boolean> => {
        try {
          const authoritativeSnapshot = retryOnStale
            ? snapshot.data!
            : await refreshSnapshot();
          if (!authoritativeSnapshot)
            throw new Error("Unable to refresh the latest game state.");

          if (authoritativeSnapshot.game.status === "completed") {
            setNotice(
              "This match has finished. Open the results screen for the debrief.",
            );
            return false;
          }
          const recoveryUntil = authoritativeSnapshot.team.healthRecoveryUntil;
          if (
            authoritativeSnapshot.team.health <= 0 ||
            (typeof recoveryUntil === "number" &&
              recoveryUntil > authoritativeSnapshot.game.serverTime)
          ) {
            setNotice(
              "City Health is recovering. Actions resume after the team recovery timer.",
            );
            return false;
          }
          const isProjectClaimAction = /\/projects\/[^/]+\/claim$/.test(path);
          const isChatAction = /\/chat\/messages$/.test(path);
          const isQuizAction = /\/health-missions\/[^/]+\/steps$/.test(path);
          const projectPathMatch = path.match(/\/projects\/([^/]+)\//);
          const projectId = projectPathMatch?.[1] ?? null;
          if (
            authoritativeSnapshot.game.status !== "active" &&
            !(
              authoritativeSnapshot.game.status === "finalizing" &&
               (isProjectClaimAction || isChatAction || isQuizAction)
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

          let response: any;
          if (method === "PUT") {
            const id = crypto.randomUUID();
            response = await api(path, {
              method,
              headers: { "idempotency-key": id },
              body: JSON.stringify({ commandId: id, ...commandPayload }),
            });
          } else response = await command(path, commandPayload);
          setNotice("Command accepted. The city state is updating.");
          if (path.endsWith("/chat/messages") && response?.result?.message) {
            const current = queryClient.getQueryData<GameSnapshot>([
              "snapshot",
              gameId,
            ]);
            const patched = current
              ? applyRealtimeSnapshotPatch(current, "chat.message.created", response.result.message)
              : null;
            if (patched) queryClient.setQueryData(["snapshot", gameId], patched);
            return true;
          }
          if (path.endsWith("/mrf/processes") && response?.result) {
            const current = queryClient.getQueryData<GameSnapshot>([
              "snapshot",
              gameId,
            ]);
            const patched = current
              ? applyRealtimeSnapshotPatch(current, "mrf.processing.updated", {
                  ...response.result,
                  teamRevision: response.teamRevision,
                })
              : null;
            if (patched) queryClient.setQueryData(["snapshot", gameId], patched);
            return true;
          }
          const current = queryClient.getQueryData<GameSnapshot>([
            "snapshot",
            gameId,
          ]);
          const receiptPatch = current
            ? applyCommandReceiptPatch(current, path, payload, response)
            : null;
          if (receiptPatch) {
            queryClient.setQueryData(["snapshot", gameId], receiptPatch);
            return true;
          }
          await refreshSnapshot();
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
      pendingCommandKeysRef.current.delete(commandKey);
    }
  };
  const teamLabelById = new Map<string, string>(
    (leaderboard.data ?? data.publicLeaderboard ?? []).map((entry: any): [string, string] => [
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
    setActionPanel(null);
    setNotice(
      `${facility === "mrf" ? "MRF" : facility === "broker" ? "Broker" : "Municipality"} is operated by your teammate. Use City Signal to coordinate with the team.`,
    );
  };
  const panelTitle =
    actionPanel === "role"
      ? workspaceTitle
      : actionPanel === "team"
        ? "Shared Warehouse"
        : "Project History";
  return (
    <main className={styles.gameShell} data-role={routeRole}>
      <CityScene
        effects={transferEffects}
        onSelectFacility={focusCityFacility}
        selectedFacility={selectedFacility}
        snapshot={data}
      />
      {teamHealthRecovering && (
        <section
          aria-live="assertive"
          aria-modal="true"
          className={styles.healthRecoveryOverlay}
          role="alertdialog"
        >
          <div className={styles.healthRecoveryPanel}>
            <p>Your City Died!</p>
            <strong>
              {formatCountdown(
                team.healthRecoveryUntil ?? displayServerTime + 30_000,
                displayServerTime,
              )}
            </strong>
            <small>Please Wait for Recovery and Gain 20% Health Back.</small>
          </div>
        </section>
      )}
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
          <div className={styles.roleIdentity}>
            <img
              className={styles.roleAvatar}
              src={roleAvatar[routeRole]}
              alt=""
            />
            <div>
              <span>Player role</span>
              <strong className={styles.playerRole}>{roleLabel}</strong>
            </div>
          </div>
          <div className={styles.matchClock}>
            <span>Game time</span>
            <strong>
              <img className={styles.timerIcon} src={asset("countdown")} alt="" />
              {countdownTarget
                ? formatCountdown(countdownTarget, displayServerTime)
                : "--:--"}
            </strong>
          </div>
        </div>
      </header>
      {tradeNotice && (
        <aside
          className={styles.tradeResponseNotice}
          data-tone={tradeNotice.tone}
          role="status"
        >
          <strong>
            Trade {tradeNotice.tone === "accepted" ? "accepted" : "declined"}
          </strong>
          <span>{tradeNotice.text}</span>
        </aside>
      )}
      {brokerPurchaseNotice && routeRole === "broker" && (
        <aside
          className={styles.brokerPurchaseNotice}
          data-has-trade={Boolean(tradeNotice)}
          role="status"
        >
          <strong>External purchase confirmed</strong>
          <span>
            Material: {brokerPurchaseNotice.material} · Amount: {formatTons(brokerPurchaseNotice.quantityKg)} · Grade: Grade B
          </span>
        </aside>
      )}
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
                    <span
                      className={styles.projectRequirement}
                      data-material={material}
                      key={material}
                    >
                      <img src={materialAsset[material]} alt="" />
                      {material}:{" "}
                      {formatTons(project.template.requirementsKg[material])}
                    </span>
                  ))}
              </div>
              {materials.some(
                (material) =>
                  (project.template.gradeARequiredKg?.[material] ?? 0) > 0,
              ) && (
                <div className={styles.requirements}>
                  <span className={styles.projectQualityLabel}>
                    Grade A critical portion
                  </span>
                  {materials
                    .filter(
                      (material) =>
                        (project.template.gradeARequiredKg?.[material] ?? 0) >
                        0,
                    )
                    .map((material) => (
                      <span
                        className={styles.projectRequirement}
                        data-material={material}
                        key={material}
                      >
                        <img src={materialAsset[material]} alt="" />
                        {material}: {formatTons(project.template.gradeARequiredKg?.[material] ?? 0)}
                      </span>
                    ))}
                </div>
              )}
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
                disabled={routeRole !== "municipality"}
                onClick={() =>
                  routeRole === "municipality" && setProjectReview(project)
                }
              >
                {routeRole !== "municipality"
                  ? "Waiting Muni's action"
                  : "Complete Project"}
              </button>
              </article>
          ))}
        </div>
      </section>
      {projectReview && routeRole === "municipality" && (
        <ProjectCompletionReview
          gameId={gameId}
          onClose={() => setProjectReview(null)}
          project={projectReview}
          rewardMultiplierBasisPoints={rewardMultiplierBasisPoints}
          send={send}
          team={team}
        />
      )}
      <GameChatDock
        announcements={data.announcements}
        busy={false}
        gameId={gameId}
        globalMessages={data.globalChatMessages}
        messages={data.chatMessages}
        role={routeRole}
        send={send}
        viewerUserId={data.viewer.userId}
      />
      <CityLeaderboard
        entries={leaderboard.data ?? data.publicLeaderboard}
        viewerTeamId={data.viewer.teamId}
      />
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
                busy={false}
                currentTime={displayServerTime}
              />
            )}
            {actionPanel === "role" && routeRole === "mrf" && (
              <Mrf
                team={team}
                gameId={gameId}
                send={send}
                busy={false}
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
                busy={false}
                currentTime={displayServerTime}
                onExternalPurchaseConfirmed={confirmBrokerPurchase}
              />
            )}
            {actionPanel === "team" && (
              <WarehouseOperations
                team={team}
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
            busy={false}
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

function ProjectCompletionReview({
  project,
  team,
  gameId,
  rewardMultiplierBasisPoints,
  send,
  onClose,
}: {
  project: GameProject;
  team: GameSnapshot["team"];
  gameId: string;
  rewardMultiplierBasisPoints: number;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const materialRows = projectMaterialEligibility(project.template, team.inventory);
  const hasEnoughMaterials = hasProjectMaterials(materialRows);
  const rewardCents = applyMultiplierCents(
    project.template.grossRevenueCents,
    rewardMultiplierBasisPoints,
  );
  const submit = async () => {
    if (!hasEnoughMaterials || submitting) return;
    setSubmitFailed(false);
    setSubmitting(true);
    const completed = await send(`/v1/games/${gameId}/projects/${project._id}/claim`, {
      expectedTeamRevision: team.revision,
      payload: { confirm: true },
    });
    setSubmitting(false);
    if (completed) onClose();
    else setSubmitFailed(true);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-describedby="project-review-description"
      aria-labelledby="project-review-title"
      className={styles.projectReviewBackdrop}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <section className={styles.projectReviewCard}>
        <header className={styles.projectReviewHeader}>
          <div>
            <span>Municipality project review</span>
            <h2 id="project-review-title">{project.template.title}</h2>
            <p>Tier {project.template.tier} · confirm shared inventory before submitting.</p>
          </div>
          <button
            aria-label="Quit project review"
            className={styles.projectReviewClose}
            onClick={onClose}
            type="button"
          >
            Quit
          </button>
        </header>

        <section className={styles.projectReward} aria-label="Project reward">
          <span>Completion reward</span>
          <strong>{formatMoney(rewardCents)}</strong>
          <p>
            {project.template.co2ImpactKg >= 0 ? "+" : "-"}
            {formatTons(Math.abs(project.template.co2ImpactKg))} CO2e project impact
          </p>
          <p>
            Estimated at {(rewardMultiplierBasisPoints / 10_000).toFixed(2)}x; the server confirms the final reward when claimed.
          </p>
        </section>

        <p className={styles.projectReviewHint} id="project-review-description">
          Only unlocked Grade A and Grade B material can contribute to project completion. Grade C material must be upgraded before it can be used.
        </p>

        <div className={styles.projectReviewTables}>
          <section>
            <div className={styles.projectReviewSectionTitle}>
              <span>Shared inventory</span>
              <strong>Current stored material</strong>
            </div>
            <div className={styles.projectReviewTableWrap}>
              <table className={styles.projectReviewTable}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Grade A</th>
                    <th>Grade B</th>
                    <th>Grade C</th>
                    <th>Unlocked A+B</th>
                  </tr>
                </thead>
                <tbody>
                  {materialRows.map((row) => (
                    <tr data-material={row.material} key={row.material}>
                      <th scope="row">
                        <span className={styles.projectReviewMaterial} data-material={row.material}>
                          <img src={materialAsset[row.material]} alt="" />
                          {row.material}
                        </span>
                      </th>
                      <td>{formatTons(row.gradeAStoredKg)}</td>
                      <td>{formatTons(row.gradeBStoredKg)}</td>
                      <td>{formatTons(row.gradeCStoredKg)}</td>
                      <td>{formatTons(row.eligibleKg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className={styles.projectReviewSectionTitle}>
              <span>Project requirements</span>
              <strong>Required to complete this listing</strong>
            </div>
            <div className={styles.projectReviewTableWrap}>
              <table className={styles.projectReviewTable}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Total required</th>
                    <th>Grade A critical (in total)</th>
                    <th>Unlocked A+B</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {materialRows.map((row) => (
                    <tr
                      data-material={row.material}
                      data-status={row.hasEnoughMaterial ? "ready" : "short"}
                      key={row.material}
                    >
                      <th scope="row">
                        <span className={styles.projectReviewMaterial} data-material={row.material}>
                          <img src={materialAsset[row.material]} alt="" />
                          {row.material}
                        </span>
                      </th>
                      <td>{formatTons(row.requiredKg)}</td>
                      <td>
                        {row.gradeARequiredKg > 0
                          ? formatTons(row.gradeARequiredKg)
                          : "None"}
                      </td>
                      <td>{formatTons(row.eligibleKg)}</td>
                      <td>
                        <span className={styles.projectRequirementStatus} data-status={row.hasEnoughMaterial ? "ready" : "short"}>
                          {row.hasEnoughMaterial ? "Ready" : "Short"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer className={styles.projectReviewFooter}>
          <p data-state={hasEnoughMaterials ? "ready" : "short"}>
            {submitFailed
              ? "The project could not be completed. The listing or authoritative city state may have changed."
              : hasEnoughMaterials
              ? "All material requirements are available."
              : "More eligible Grade A/B material is needed before this project can be completed."}
          </p>
          <button
            className={styles.projectReviewSubmit}
            disabled={!hasEnoughMaterials || submitting}
            onClick={() => void submit()}
            type="button"
          >
            {submitting ? "Completing project..." : "Complete Project"}
          </button>
        </footer>
      </section>
    </dialog>
  );
}

type GameChatTab = "announcements" | "team" | "global" | "ai";

const gameChatTabs: Array<{
  id: GameChatTab;
  label: string;
  shortLabel: string;
}> = [
  { id: "announcements", label: "Announcements", shortLabel: "ANN" },
  { id: "team", label: "Team chat", shortLabel: "TEAM" },
  { id: "global", label: "Global chat", shortLabel: "ALL" },
  { id: "ai", label: "Chat with AI", shortLabel: "AI" },
];

function GameChatDock({
  announcements,
  busy,
  gameId,
  globalMessages,
  messages,
  role,
  send,
  viewerUserId,
}: {
  announcements: GameSnapshot["announcements"];
  busy: boolean;
  gameId: string;
  globalMessages: GameSnapshot["globalChatMessages"];
  messages: GameSnapshot["chatMessages"];
  role: Role;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  viewerUserId: string;
}) {
  const [activeTab, setActiveTab] = useState<GameChatTab>("announcements");
  const active = gameChatTabs.find((tab) => tab.id === activeTab)!;
  const isLive =
    activeTab === "announcements" || activeTab === "team" || activeTab === "global" || activeTab === "ai";

  return (
    <aside className={styles.gameChatDock} aria-label="Game communications">
      <header className={styles.gameChatHeader}>
        <div>
          <span>City Signal</span>
          <h2>{active.label}</h2>
        </div>
        <i aria-label={isLive ? "Live channel" : "Preview UI"}>
          {isLive ? "Live" : "Preview"}
        </i>
      </header>
      <div className={styles.gameChatTabs} role="tablist" aria-label="Chat channels">
        {gameChatTabs.map((tab) => (
          <button
            aria-controls={`game-chat-${tab.id}`}
            aria-selected={activeTab === tab.id}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            <span>{tab.shortLabel}</span>
          </button>
        ))}
      </div>
      <div
        className={styles.gameChatPanel}
        id={`game-chat-${activeTab}`}
        key={activeTab}
        role="tabpanel"
      >
        {activeTab === "announcements" && (
          <AnnouncementChannel announcements={announcements} />
        )}
        {activeTab === "team" && (
          <TeamChannel
            busy={busy}
            gameId={gameId}
            messages={messages}
            send={send}
            viewerUserId={viewerUserId}
          />
        )}
        {activeTab === "global" && (
          <GlobalChannel
            busy={busy}
            gameId={gameId}
            messages={globalMessages}
            role={role}
            send={send}
            viewerUserId={viewerUserId}
          />
        )}
        {activeTab === "ai" && <AiChannel gameId={gameId} role={role} />}
      </div>
    </aside>
  );
}

function CityLeaderboard({
  entries,
  viewerTeamId,
}: {
  entries: GameSnapshot["publicLeaderboard"];
  viewerTeamId: string;
}) {
  return (
    <aside className={styles.cityLeaderboard} aria-labelledby="city-leaderboard-title">
      <header>
        <div>
          <span>Live standings</span>
          <h2 id="city-leaderboard-title">City ranking</h2>
        </div>
        <i>{entries.length} cities</i>
      </header>
      <div className={styles.cityLeaderboardTableWrap}>
        <table>
          <thead>
            <tr>
              <th scope="col">City</th>
              <th scope="col">Wallet</th>
              <th scope="col">CO2 ×</th>
              <th scope="col">Rank</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                data-current-city={entry.teamId === viewerTeamId}
                key={entry.teamId}
              >
                <th scope="row">
                  <strong>{entry.name ?? `City ${entry.citySlot}`}</strong>
                  <span>City {entry.citySlot}</span>
                </th>
                <td>{formatMoney(entry.walletCents)}</td>
                <td>{formatMultiplier(entry.rewardMultiplierBasisPoints)}</td>
                <td>
                  <b>{entry.rank}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}

function useFeedAutoScroll(itemCount: number) {
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feed.current?.scrollTo({
      top: feed.current.scrollHeight,
      behavior: itemCount > 1 ? "smooth" : "auto",
    });
  }, [itemCount]);
  return feed;
}

const formatChannelTime = (timestamp: number): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);

/** Durable game-wide system feed. */
function AnnouncementChannel({
  announcements,
}: {
  announcements: GameSnapshot["announcements"];
}) {
  const feed = useFeedAutoScroll(announcements.length);
  return (
    <div className={styles.announcementChannel} ref={feed}>
      {announcements.length === 0 ? (
        <div className={styles.chatChannelPlaceholder} data-channel="announcements">
          <span className={styles.chatChannelPulse} />
          <strong>System feed online</strong>
          <p>Time milestones and project winners will appear here.</p>
          <small>Waiting for the first city signal</small>
        </div>
      ) : (
        announcements.map((announcement) => (
          <article
            className={styles.announcementMessage}
            data-type={announcement.type}
            key={announcement._id}
          >
            <span>
              {announcement.type === "project-win" ? "Project result" : "Time update"}
            </span>
            <p>{announcement.message}</p>
            <time>{formatChannelTime(announcement.createdAtMs)}</time>
          </article>
        ))
      )}
    </div>
  );
}

/** Authenticated, same-team player message feed. */
function TeamChannel({
  busy,
  gameId,
  messages,
  send,
  viewerUserId,
}: {
  busy: boolean;
  gameId: string;
  messages: GameSnapshot["chatMessages"];
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  viewerUserId: string;
}) {
  const [draft, setDraft] = useState("");
  const feed = useFeedAutoScroll(messages.length);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    const accepted = await send(`/v1/games/${gameId}/chat/messages`, {
      payload: { channel: "team", message },
    });
    if (accepted) setDraft("");
  };

  return (
    <div className={styles.teamChatChannel}>
      <div className={styles.teamChatFeed} ref={feed}>
        {messages.length === 0 ? (
          <div className={styles.chatChannelPlaceholder} data-channel="team">
            <strong>Team channel ready</strong>
            <p>Coordinate collection, recovery, and trading with your team.</p>
          </div>
        ) : (
          messages.map((message) => {
            const ownMessage = message.senderUserId === viewerUserId;
            const senderRole =
              message.senderRole === "mrf"
                ? "MRF"
                : message.senderRole[0]?.toUpperCase() +
                  message.senderRole.slice(1);
            return (
              <article
                className={styles.teamChatMessage}
                data-own={ownMessage}
                key={message._id}
              >
                <span>
                  {ownMessage ? "You" : message.senderName ?? "Teammate"} · {senderRole}
                </span>
                <p>{message.content}</p>
                <time>{formatChannelTime(message.createdAtMs)}</time>
              </article>
            );
          })
        )}
      </div>
      <form className={styles.teamChatComposer} onSubmit={submit}>
        <input
          aria-label="Message your team"
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Send message to team members`}
          value={draft}
        />
        <button disabled={busy || !draft.trim()} type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

/** Authenticated game-wide player message feed. */
function GlobalChannel({
  busy,
  gameId,
  messages,
  role,
  send,
  viewerUserId,
}: {
  busy: boolean;
  gameId: string;
  messages: GameSnapshot["globalChatMessages"];
  role: Role;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  viewerUserId: string;
}) {
  const [draft, setDraft] = useState("");
  const feed = useFeedAutoScroll(messages.length);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    const accepted = await send(`/v1/games/${gameId}/chat/messages`, {
      payload: { channel: "global", message },
    });
    if (accepted) setDraft("");
  };

  return (
    <div className={styles.teamChatChannel}>
      <div className={styles.teamChatFeed} ref={feed}>
        {messages.length === 0 ? (
          <div className={styles.chatChannelPlaceholder} data-channel="global">
            <strong>Global channel ready</strong>
            <p>Share strategy and celebrate progress with every active city.</p>
          </div>
        ) : (
          messages.map((message) => {
            const ownMessage = message.senderUserId === viewerUserId;
            const senderRole =
              message.senderRole === "mrf"
                ? "MRF"
                : message.senderRole[0]?.toUpperCase() +
                  message.senderRole.slice(1);
            return (
              <article
                className={styles.teamChatMessage}
                data-own={ownMessage}
                key={message._id}
              >
                <span>
                  {ownMessage ? "You" : message.senderName ?? "Player"} · {senderRole}
                </span>
                <p>{message.content}</p>
                <time>{formatChannelTime(message.createdAtMs)}</time>
              </article>
            );
          })
        )}
      </div>
      <form className={styles.teamChatComposer} onSubmit={submit}>
        <input
          aria-label="Message all cities"
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Message all cities as ${role}`}
          value={draft}
        />
        <button disabled={busy || !draft.trim()} type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

type AiConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ id: string; title: string; score: number }>;
};

function AiChannel({ gameId, role }: { gameId: string; role: Role }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const feed = useFeedAutoScroll(messages.length);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    const history = messages.slice(-8).map(({ role: messageRole, content }) => ({
      role: messageRole,
      content,
    }));
    setMessages((current) => [
      ...current,
      { id: `user-${crypto.randomUUID()}`, role: "user", content: message },
    ]);
    setDraft("");
    setError("");
    setSending(true);
    try {
      const response = await api<{
        reply: string;
        sources: Array<{ id: string; title: string; score: number }>;
      }>(`/v1/games/${gameId}/chatbot/messages`, {
        method: "POST",
        body: JSON.stringify({ message, history }),
      });
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${crypto.randomUUID()}`,
          role: "assistant",
          content: response.reply,
          sources: response.sources,
        },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The AI advisor is temporarily unavailable. Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.aiChatChannel}>
      <div className={styles.aiChatFeed} ref={feed}>
        {messages.length === 0 ? (
          <div className={styles.chatChannelPlaceholder} data-channel="ai">
            <span className={styles.chatChannelPulse} />
            <strong>AI advisor ready</strong>
            <p>Ask about game rules, circular-economy concepts, or how your {role} role can act.</p>
            <small>The advisor explains; it cannot perform game actions.</small>
          </div>
        ) : (
          messages.map((message) => (
            <article className={styles.aiChatMessage} data-role={message.role} key={message.id}>
              <span>{message.role === "user" ? "You" : "AI advisor"}</span>
              <MarkdownText className={styles.aiMarkdown} content={message.content} />
              {message.sources && message.sources.length > 0 && (
                <div className={styles.aiSources}>
                  {message.sources.map((source) => (
                    <small key={source.id}>{source.title}</small>
                  ))}
                </div>
              )}
            </article>
          ))
        )}
        {sending && <p className={styles.aiThinking}>AI advisor is thinking...</p>}
      </div>
      {error && <p className={styles.aiError}>{error}</p>}
      <form className={styles.teamChatComposer} onSubmit={submit}>
        <input
          aria-label="Ask the AI advisor"
          maxLength={2000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about the game or circular economy"
          value={draft}
        />
        <button disabled={sending || !draft.trim()} type="submit">
          {sending ? "..." : "Ask"}
        </button>
      </form>
    </div>
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
          <div
            data-material={material}
            key={material}
            title={`${material}: ${formatTons(total)} total`}
          >
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

function RoleTabs({
  tab,
  onChange,
  role,
}: {
  tab: "operations" | "inventory";
  onChange: (tab: "operations" | "inventory") => void;
  role: Role;
}) {
  return (
    <div className={styles.workspaceTabs} role="tablist" aria-label={`${role} workspace`}>
      {(["operations", "inventory"] as const).map((value) => (
        <button
          aria-selected={tab === value}
          key={value}
          onClick={() => onChange(value)}
          role="tab"
          type="button"
        >
          {value === "operations" ? "Operations" : "My inventory"}
        </button>
      ))}
    </div>
  );
}

function RoleInventoryPanel({
  team,
  role,
  gameId,
  send,
  busy,
  currentTime,
}: {
  team: GameSnapshot["team"];
  role: Role;
  gameId: string;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
}) {
  const inventory = team.roleInventories?.[role] ?? team.inventory;
  const destinations = (["municipality", "mrf", "broker"] as Role[]).filter(
    (candidate) => candidate !== role,
  );
  const [material, setMaterial] = useState<Material>("paper");
  const [grade, setGrade] = useState<Grade>("B");
  const [quantityKg, setQuantityKg] = useState(100);
  const [toRole, setToRole] = useState<Role>(destinations[0]!);
  const [route, setRoute] = useState<Route>("standard");
  const availableKg = Math.max(
    0,
    inventory[material][grade] -
      (inventory[material][`locked${grade}` as "lockedA" | "lockedB" | "lockedC"] ??
        0),
  );
  const validQuantity =
    Number.isInteger(quantityKg) && quantityKg > 0 && quantityKg <= availableKg;
  const transfers = team.materialTransfers ?? [];
  useEffect(() => {
    if (availableKg > 0) {
      setQuantityKg((current) => Math.min(Math.max(1, current), availableKg));
      return;
    }
    const firstAvailable = materials
      .flatMap((candidateMaterial) =>
        grades.map((candidateGrade) => ({
          material: candidateMaterial,
          grade: candidateGrade,
          availableKg: Math.max(
            0,
            inventory[candidateMaterial][candidateGrade] -
              (inventory[candidateMaterial][
                `locked${candidateGrade}` as "lockedA" | "lockedB" | "lockedC"
              ] ?? 0),
          ),
        })),
      )
      .find((candidate) => candidate.availableKg > 0);
    if (!firstAvailable) return;
    setMaterial(firstAvailable.material);
    setGrade(firstAvailable.grade);
    setQuantityKg(Math.min(100, firstAvailable.availableKg));
  }, [availableKg, inventory, team.revision]);

  return (
    <section className={styles.roleInventoryPanel} role="tabpanel">
      <div className={styles.roleInventoryGrid}>
        {materials.map((item) => {
          const stock = inventory[item];
          const totalKg = stock.A + stock.B + stock.C;
          return (
          <article data-material={item} key={item}>
            <div className={styles.materialCardHeading}>
              <img src={materialAsset[item]} alt="" />
              <span>{item}</span>
              <div>
                <small>Total held</small>
                <strong>{formatTons(totalKg)}</strong>
              </div>
            </div>
            <dl className={styles.materialGradeGrid}>
              {grades.map((itemGrade) => (
                <div key={itemGrade}>
                  <dt>Grade {itemGrade}</dt>
                  <dd>{formatTons(stock[itemGrade])}</dd>
                </div>
              ))}
            </dl>
          </article>
          );
        })}
      </div>

      {role !== "municipality" && (
      <div className={styles.transferComposer} data-material={material}>
        <h3>Dispatch material</h3>
        <label>
          Material
          <select value={material} onChange={(event) => setMaterial(event.target.value as Material)}>
            {materials.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Grade
          <select value={grade} onChange={(event) => setGrade(event.target.value as Grade)}>
            {grades.map((item) => (
              <option key={item} value={item}>Grade {item}</option>
            ))}
          </select>
        </label>
        <label>
          Quantity kg
          <input
            max={Math.max(1, availableKg)}
            min="1"
            step="1"
            type="number"
            value={quantityKg}
            onChange={(event) => setQuantityKg(Number(event.target.value))}
          />
        </label>
        <label>
          Destination
          <select value={toRole} onChange={(event) => setToRole(event.target.value as Role)}>
            {destinations.map((destination) => (
              <option key={destination} value={destination}>{destination}</option>
            ))}
          </select>
        </label>
        <fieldset className={styles.routeChoices}>
          <legend>Transport route</legend>
          {transferRoutes.map((choice) => (
            <label className={styles.routeOption} key={choice.route}>
              <input
                checked={route === choice.route}
                name={`${role}-transfer-route`}
                onChange={() => setRoute(choice.route)}
                type="radio"
              />
              <strong className={styles.routeLabel}>{choice.label}</strong>
              <span className={styles.routeMetrics}>{choice.detail}</span>
              <span className={styles.controlHelp} role="tooltip">
                Time · cost per kg · CO2 per kg
              </span>
            </label>
          ))}
        </fieldset>
        <output className={styles.transferAvailability} data-material={material}>
          <span>Available</span>
          <strong>{formatTons(availableKg)}</strong>
          <small>Grade {grade} {material}</small>
        </output>
        <div className={styles.dispatchAction}>
          <button
            disabled={busy || !validQuantity}
            onClick={() =>
              void send(`/v1/games/${gameId}/material-transfers`, {
                expectedTeamRevision: team.revision,
                payload: { toRole, materialType: material, grade, quantityKg, route },
              })
            }
            type="button"
          >
            Dispatch to {toRole}
          </button>
          <span className={styles.controlHelp} role="tooltip">
            Sends the selected stock through the chosen route. Inventory settles when it arrives.
          </span>
        </div>
      </div>
      )}

      {transfers.length > 0 && (
        <div className={styles.transferList}>
          <h3>Materials in transit</h3>
          {transfers.map((transfer) => (
            <article data-material={transfer.materialType} key={transfer._id}>
              <span>{transfer.fromRole} → {transfer.toRole}</span>
              <strong>{formatTons(transfer.quantityKg)}</strong>
              <span>Grade {transfer.grade} · {transfer.route}</span>
              <time>ETA {formatCountdown(transfer.arrivesAt, currentTime)}</time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function WasteComposition({
  compositionKg,
}: {
  compositionKg?: Partial<Record<Material, number>>;
}) {
  return (
    <div className={styles.collectionComposition} aria-label="Batch material composition">
      {materials
        .filter((material) => (compositionKg?.[material] ?? 0) > 0)
        .map((material) => (
          <span className={styles.collectionMaterial} data-material={material} key={material}>
            <img src={materialAsset[material]} alt="" />
            <b>{material}</b>
            <strong>{formatTons(compositionKg?.[material] ?? 0)}</strong>
          </span>
        ))}
    </div>
  );
}

function Municipality({
  team,
  gameId,
  send,
  busy,
  currentTime,
}: {
  team: GameSnapshot["team"];
  gameId: string;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
}) {
  const [tab, setTab] = useState<"operations" | "inventory">("operations");
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
  const dispatchCollection = (wasteSourceId: string, route: Route) =>
    void send(`/v1/games/${gameId}/municipality/collections`, {
      expectedTeamRevision: team.revision,
      payload: { wasteSourceId, route },
    });
  return (
    <section className={styles.roleWorkspace}>
      <RoleTabs onChange={setTab} role="municipality" tab={tab} />
      {tab === "operations" ? (
        <div className={styles.queue} role="tabpanel">
          {transitSources.map((source: any) => {
            const sourceTransport = transportBySourceId.get(String(source._id));
            const route = sourceTransport?.route ?? "standard";
            const routeOption = transferRoutes.find((option) => option.route === route);
            const arrivesAt = sourceTransport?.arrivesAt ?? source.transitArrivesAt ?? currentTime;
            return (
              <article
                className={styles.collectionBatch}
                data-status="in-transit"
                key={source._id}
              >
                <div className={styles.collectionBatchHeader}>
                  <strong className={styles.batchTitle}>
                    <img src={asset("material-bale")} alt="" />
                    Waste batch
                  </strong>
                  <b>{formatTons(source.massKg)}</b>
                </div>
                <WasteComposition compositionKg={source.compositionKg} />
                <div className={styles.transportCountdownOverlay}>
                  <span>{routeOption?.label ?? "Standard"} route to MRF</span>
                  <strong>{formatTransportCountdown(arrivesAt, currentTime)}</strong>
                  <small>Arrival countdown</small>
                </div>
              </article>
            );
          })}
          {availableSources.map((source: any) => (
            <article className={styles.collectionBatch} key={source._id}>
              <div className={styles.collectionBatchHeader}>
                <strong className={styles.batchTitle}>
                  <img src={asset("material-bale")} alt="" />
                  Incoming waste
                </strong>
                <b>{formatTons(source.massKg)}</b>
              </div>
              <div className={styles.collectionBatchMeta}>
                <span>Contamination <strong>{(source.contaminationBasisPoints / 100).toFixed(0)}%</strong></span>
                <span>Expires <strong>{formatCountdown(source.expiresAt, currentTime)}</strong></span>
              </div>
              <WasteComposition compositionKg={source.compositionKg} />
              <div className={styles.collectionRoutes} role="group" aria-label="Transport options">
                {transferRoutes.map((option) => (
                  <button
                    className={styles.collectionRouteButton}
                    data-route={option.route}
                    disabled={busy}
                    key={option.route}
                    onClick={() => dispatchCollection(source._id, option.route)}
                    type="button"
                  >
                    <span className={styles.collectionRouteMode}>{option.label}</span>
                    <span className={styles.collectionRouteMetrics}>
                      <span><small>Arrival</small><strong>{option.time}</strong></span>
                      <span><small>Cost</small><strong>{option.price}</strong></span>
                      <span><small>CO2</small><strong>{option.co2}</strong></span>
                    </span>
                  </button>
                ))}
              </div>
            </article>
          ))}
          {availableSources.length === 0 && transitSources.length === 0 && (
            <p className="muted">No collection opportunities available.</p>
          )}
        </div>
      ) : (
        <RoleInventoryPanel
          busy={busy}
          currentTime={currentTime}
          gameId={gameId}
          role="municipality"
          send={send}
          team={team}
        />
      )}
    </section>
  );
}
function Mrf({
  team,
  gameId,
  send,
  busy,
  currentTime,
}: {
  team: GameSnapshot["team"];
  gameId: string;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
}) {
  const [tab, setTab] = useState<
    "decompose" | "recycle" | "upgrade" | "inventory"
  >("decompose");
  const guideBySource = team.mrfActionGuide ?? {};
  const rawBatches = team.wasteSources.filter(
    (source: any) => source.status === "at_mrf",
  );
  const materialStreams = team.wasteSources.filter(
    (source: any) => source.status === "held",
  );
  return (
    <section className={styles.roleWorkspace}>
      <div className={styles.workspaceTabs} role="tablist" aria-label="MRF workspace">
        <button
          aria-selected={tab === "decompose"}
          onClick={() => setTab("decompose")}
          role="tab"
          type="button"
        >
          Decompose
        </button>
        <button
          aria-selected={tab === "recycle"}
          onClick={() => setTab("recycle")}
          role="tab"
          type="button"
        >
          Recycle
        </button>
        <button
          aria-selected={tab === "upgrade"}
          onClick={() => setTab("upgrade")}
          role="tab"
          type="button"
        >
          Upgrade quality
        </button>
        <button
          aria-selected={tab === "inventory"}
          onClick={() => setTab("inventory")}
          role="tab"
          type="button"
        >
          My inventory
        </button>
      </div>
      {tab === "decompose" ? (
        <div className={styles.queue} role="tabpanel">
          {rawBatches.map((source: any) => (
            <article className={styles.collectionBatch} key={source._id}>
              <div className={styles.collectionBatchHeader}>
                <strong className={styles.batchTitle}>
                  <img src={asset("material-bale")} alt="" />
                  Arrived waste batch
                </strong>
                <b>{formatTons(source.massKg)}</b>
              </div>
              <div className={styles.collectionBatchMeta}>
                <span>
                  Contamination <strong>{(source.contaminationBasisPoints / 100).toFixed(0)}%</strong>
                </span>
              </div>
              <WasteComposition compositionKg={source.compositionKg} />
              <button
                disabled={busy}
                onClick={() =>
                  void send(`/v1/games/${gameId}/mrf/decompositions`, {
                    expectedTeamRevision: team.revision,
                    payload: { wasteSourceId: source._id },
                  })
                }
                type="button"
              >
                Decompose Waste
              </button>
            </article>
          ))}
          {rawBatches.length === 0 && (
            <p className="muted">No raw waste batches are waiting for decomposition.</p>
          )}
        </div>
      ) : tab === "recycle" ? (
        <div className={styles.queue} role="tabpanel">
        {materialStreams.map((source: any) => {
          const guides = guideBySource[source._id] ?? [];
          const recyclingGuide = guides.find((guide) => guide.kind === "recycling");
          const landfillGuide = guides.find((guide) => guide.methodId === "landfill");
          const startProcess = (methodId: ProcessingMethodId) =>
            void send(`/v1/games/${gameId}/mrf/processes`, {
              expectedTeamRevision: team.revision,
              payload: { wasteSourceId: source._id, methodId },
            });
          return (
            <article className={styles.mrfBatchCard} key={source._id}>
              <strong className={styles.batchTitle}>
                <img src={asset("material-bale")} alt="" />
                Separated material stream
              </strong>
              <span>
                Contamination {" "}
                {(source.contaminationBasisPoints / 100).toFixed(0)}%
              </span>
              <WasteComposition compositionKg={source.compositionKg} />
              <p className={styles.recyclePrompt}>Choose one material path</p>
              <div className={styles.recycleChoices}>
                {recyclingGuide && (
                  <button
                    className={styles.recycleChoice}
                    data-kind="recycling"
                    disabled={busy || !recyclingGuide.eligible}
                    onClick={() => startProcess(recyclingGuide.methodId as ProcessingMethodId)}
                    type="button"
                  >
                    <span>Recycle material</span>
                    <strong>{recyclingGuide.title}</strong>
                    <small>{recyclingGuide.description}</small>
                    <dl>
                      <div><dt>Output</dt><dd>{formatTons(recyclingGuide.recoveredKg)} · Grade {recyclingGuide.grade ?? "-"}</dd></div>
                      <div><dt>Time</dt><dd>{Math.floor(recyclingGuide.durationMs / 1000)}s</dd></div>
                      <div><dt>Cost</dt><dd>{formatMoney(recyclingGuide.totalCostCents)}</dd></div>
                      <div><dt>CO2</dt><dd>+{formatTons(recyclingGuide.totalCO2Kg)}</dd></div>
                    </dl>
                    {!recyclingGuide.eligible && <em>Too contaminated for recovery</em>}
                  </button>
                )}
                {landfillGuide && (
                  <button
                    className={styles.recycleChoice}
                    data-kind="landfill"
                    disabled={busy || !landfillGuide.eligible}
                    onClick={() => startProcess(landfillGuide.methodId as ProcessingMethodId)}
                    type="button"
                  >
                    <span>Send to landfill</span>
                    <strong>Final disposal</strong>
                    <small>No usable material is recovered from this stream.</small>
                    <dl>
                      <div><dt>Output</dt><dd>None</dd></div>
                      <div><dt>Time</dt><dd>{Math.floor(landfillGuide.durationMs / 1000)}s</dd></div>
                      <div><dt>Cost</dt><dd>{formatMoney(landfillGuide.totalCostCents)}</dd></div>
                      <div><dt>CO2</dt><dd>+{formatTons(landfillGuide.totalCO2Kg)}</dd></div>
                    </dl>
                  </button>
                )}
              </div>
            </article>
          );
        })}
          {team.activeJobs.map((job) => (
            <p className={styles.processingStatus} key={job._id}>
              {job.methodId.replaceAll("-", " ")} completes in{" "}
              {formatCountdown(job.dueAt, currentTime)}.
            </p>
          ))}
          {!team.activeJobs.length &&
            materialStreams.length === 0 && (
              <p className="muted">No separated materials are waiting for recycling.</p>
            )}
        </div>
      ) : tab === "upgrade" ? (
        <QualityUpgradePanel
          busy={busy}
          currentTime={currentTime}
          gameId={gameId}
          send={send}
          team={team}
        />
      ) : (
        <RoleInventoryPanel
          busy={busy}
          currentTime={currentTime}
          gameId={gameId}
          role="mrf"
          send={send}
          team={team}
        />
      )}
    </section>
  );
}
function QualityUpgradePanel({
  team,
  gameId,
  send,
  busy,
  currentTime,
}: {
  team: GameSnapshot["team"];
  gameId: string;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
}) {
  const [material, setMaterial] = useState<Material>("paper");
  const [quantityKg, setQuantityKg] = useState(100);
  const availableKg = Math.max(
    0,
    Math.min(
      team.roleInventories.mrf[material].C -
        (team.roleInventories.mrf[material].lockedC ?? 0),
      team.inventory[material].C - (team.inventory[material].lockedC ?? 0),
    ),
  );
  const validQuantity =
    Number.isInteger(quantityKg) &&
    quantityKg >= 2 &&
    quantityKg <= Math.min(10_000, availableKg);
  const outputKg = Math.floor(
    (Math.max(0, quantityKg) * QUALITY_UPGRADE.recoveryRateBasisPoints) / 10_000,
  );
  const costCents = Math.max(0, quantityKg) * QUALITY_UPGRADE.costCentsPerKg;
  const co2Kg = Math.round(
    (Math.max(0, quantityKg) * QUALITY_UPGRADE.co2MilliKgPerKg) / 1000,
  );
  const activeUpgrades = team.activeQualityUpgrades ?? [];
  return (
    <div className={styles.queue} role="tabpanel">
      <article className={styles.mrfBatchCard}>
        <strong className={styles.batchTitle}>
          <img src={asset("material-bale")} alt="" />
          Upgrade Grade C material
        </strong>
        <p className={styles.recyclePrompt}>
          Re-sort and clean MRF-held Grade C stock into less, project-eligible Grade B material.
        </p>
        <div className={styles.purchase}>
          <label>
            Grade C material
            <select
              onChange={(event) => setMaterial(event.target.value as Material)}
              value={material}
            >
              {materials.map((item) => (
                <option key={item} value={item}>
                  {item} ({formatTons(Math.max(0, team.roleInventories.mrf[item].C - (team.roleInventories.mrf[item].lockedC ?? 0)))})
                </option>
              ))}
            </select>
          </label>
          <label>
            Input kg
            <input
              max={Math.min(10_000, availableKg)}
              min={2}
              onChange={(event) => setQuantityKg(Number(event.target.value))}
              step={1}
              type="number"
              value={quantityKg}
            />
          </label>
          <div className={styles.mrfGuide}>
            <strong>{formatTons(outputKg)} Grade B output</strong>
            <span>{formatTons(Math.max(0, quantityKg - outputKg))} removed as residue</span>
            <span>{QUALITY_UPGRADE.durationMs / 1000}s · {formatMoney(costCents)} · +{formatTons(co2Kg)}</span>
          </div>
          <button
            disabled={busy || !validQuantity || team.walletCents < costCents}
            onClick={() =>
              void send(`/v1/games/${gameId}/mrf/quality-upgrades`, {
                expectedTeamRevision: team.revision,
                payload: {
                  materialType: material,
                  inputGrade: "C",
                  targetGrade: "B",
                  quantityKg,
                },
              })
            }
            type="button"
          >
            Upgrade Grade C to Grade B
          </button>
        </div>
        {!validQuantity && (
          <small>Choose 2 kg or more of unlocked Grade C stock held by the MRF.</small>
        )}
        {team.walletCents < costCents && <small>Team wallet cannot cover this upgrade.</small>}
      </article>
      {activeUpgrades.map((upgrade) => (
        <p className={styles.processingStatus} key={upgrade._id}>
          Upgrading {formatTons(upgrade.result.inputKg)} Grade C {upgrade.materialType} to {formatTons(upgrade.result.outputKg)} Grade B in {formatCountdown(upgrade.dueAt, currentTime)}.
        </p>
      ))}
      {activeUpgrades.length === 0 && !materials.some((item) => team.roleInventories.mrf[item].C > 0) && (
        <p className="muted">No MRF-held Grade C material is available for quality upgrading.</p>
      )}
    </div>
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
  onExternalPurchaseConfirmed,
}: {
  team: GameSnapshot["team"];
  gameId: string;
  teams: { teamId: string; citySlot: number; name?: string }[];
  trades: unknown[] | undefined;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
  currentTime: number;
  onExternalPurchaseConfirmed: (material: Material, quantityKg: number) => void;
}) {
  const [workspaceTab, setWorkspaceTab] = useState<"operations" | "inventory">(
    "operations",
  );
  const [tab, setTab] = useState<"send" | "incoming" | "external">("send");
  const [material, setMaterial] = useState<Material>("metal");
  const [quantity, setQuantity] = useState(1000);
  const [requestedMaterial, setRequestedMaterial] = useState<Material>("paper");
  const [offerGrade, setOfferGrade] = useState<Grade>("B");
  const [requestedGrade, setRequestedGrade] = useState<Grade>("B");
  const [offerQuantity, setOfferQuantity] = useState(1000);
  const [requestedQuantity, setRequestedQuantity] = useState(1000);
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
    team.roleInventories.broker[material][offerGrade] -
      (team.roleInventories.broker[material][
        `locked${offerGrade}` as "lockedA" | "lockedB" | "lockedC"
      ] ?? 0),
  );
  const validQuantity =
    Number.isFinite(quantity) && quantity >= 100 && quantity % 100 === 0;
  const validOfferQuantity =
    Number.isFinite(offerQuantity) &&
    offerQuantity >= 100 &&
    offerQuantity % 100 === 0;
  const validRequestedQuantity =
    Number.isFinite(requestedQuantity) &&
    requestedQuantity >= 100 &&
    requestedQuantity % 100 === 0;
  const orderedTrades = [...(trades ?? [])].sort(
    (left: any, right: any) =>
      (right.deliveryDueAt ?? right.expiresAt ?? 0) -
      (left.deliveryDueAt ?? left.expiresAt ?? 0),
  );
  const outgoingTrades = orderedTrades.filter(
    (offer: any) => offer.offeringTeamId === team.teamId,
  );
  const incomingTrades = orderedTrades.filter(
    (offer: any) => offer.recipientTeamId === team.teamId && offer.status === "open",
  );
  const teamById = new Map(
    teams.map((candidate: any) => [String(candidate.teamId), candidate]),
  );
  const availableForRequest = (materialType: Material, grade: Grade) =>
    Math.max(
      0,
      team.roleInventories.broker[materialType][grade] -
        (team.roleInventories.broker[materialType][
          `locked${grade}` as "lockedA" | "lockedB" | "lockedC"
        ] ?? 0),
    );
  const purchaseExternalMaterial = async () => {
    const confirmed = await send(`/v1/games/${gameId}/broker/external-purchases`, {
      expectedTeamRevision: team.revision,
      payload: { materialType: material, quantityKg: quantity },
    });
    if (confirmed) onExternalPurchaseConfirmed(material, quantity);
  };

  return (
    <section className={styles.roleWorkspace}>
      <RoleTabs onChange={setWorkspaceTab} role="broker" tab={workspaceTab} />
      {workspaceTab === "operations" ? (
    <section className={styles.overlaySection} role="tabpanel">
      <div className={styles.brokerTabs} role="tablist" aria-label="Broker actions">
        <button
          aria-selected={tab === "send"}
          role="tab"
          type="button"
          onClick={() => setTab("send")}
        >
          Send Trade Offer
        </button>
        <button
          aria-selected={tab === "incoming"}
          role="tab"
          type="button"
          onClick={() => setTab("incoming")}
        >
          Incoming Trade Offer{incomingTrades.length ? ` (${incomingTrades.length})` : ""}
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
          <div className={styles.externalPurchaseGrade}>
            <strong>All external-market material arrives as Grade B</strong>
            <span>
              Grade B stock is added to the Broker allocation and is eligible for standard project requirements.
            </span>
          </div>
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
            onClick={() => void purchaseExternalMaterial()}
          >
            Purchase {formatTons(quantity)} for {formatMoney(externalCostCents)} ·
            +{formatTons(externalCo2Kg)} CO2e
          </button>
        </div>
      )}

      {tab === "send" && (
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
            Trade mode
            <select
              value={deliveryMode}
              onChange={(event) =>
                setDeliveryMode(event.target.value as "standard" | "low-carbon")
              }
            >
              <option value="standard">Standard: instant · $40 · 0.35 tCO2e</option>
              <option value="low-carbon">
                Low carbon: instant · $25 · 0.15 tCO2e
              </option>
            </select>
          </label>
          <label>
            You offer material and grade
            <select
              value={`${material}:${offerGrade}`}
              onChange={(event) => {
                const [nextMaterial, nextGrade] = event.target.value.split(":") as [
                  Material,
                  Grade,
                ];
                setMaterial(nextMaterial);
                setOfferGrade(nextGrade);
              }}
            >
              {materials.flatMap((item) =>
                grades.map((grade) => (
                  <option value={`${item}:${grade}`} key={`${item}:${grade}`}>
                    {item} · Grade {grade}
                  </option>
                )),
              )}
            </select>
          </label>
          <label>
            Offer amount kg
            <input
              type="number"
              min="100"
              max="10000"
              step="100"
              value={offerQuantity}
              onChange={(event) => setOfferQuantity(Number(event.target.value))}
            />
          </label>
          <label>
            You request material and grade
            <select
              value={`${requestedMaterial}:${requestedGrade}`}
              onChange={(event) => {
                const [nextMaterial, nextGrade] = event.target.value.split(":") as [
                  Material,
                  Grade,
                ];
                setRequestedMaterial(nextMaterial);
                setRequestedGrade(nextGrade);
              }}
            >
              {materials.flatMap((item) =>
                grades.map((grade) => (
                  <option value={`${item}:${grade}`} key={`${item}:${grade}`}>
                    {item} · Grade {grade}
                  </option>
                )),
              )}
            </select>
          </label>
          <label>
            Request amount kg
            <input
              type="number"
              min="100"
              max="10000"
              step="100"
              value={requestedQuantity}
              onChange={(event) => setRequestedQuantity(Number(event.target.value))}
            />
          </label>
          <button
            disabled={
              busy ||
              !recipientTeamId ||
              !validOfferQuantity ||
              !validRequestedQuantity ||
              availableOfferKg < offerQuantity
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
                          grade: offerGrade,
                          quantityKg: offerQuantity,
                        },
                      ],
                      cashCents: 0,
                    },
                    requested: {
                      materials: [
                        {
                          materialType: requestedMaterial,
                          grade: requestedGrade,
                          quantityKg: requestedQuantity,
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
          {recipientTeamId && availableOfferKg < offerQuantity && (
            <p className="muted">
              You need {formatTons(offerQuantity - availableOfferKg)} more Grade {offerGrade} {material}
              to make this offer.
            </p>
          )}
          <div className={styles.tradeList}>
            {outgoingTrades.map((offer: any) => {
              const offered = offer.terms.offered.materials[0];
              const requested = offer.terms.requested.materials[0];
              const etaTarget =
                offer.status === "open" ? offer.expiresAt : undefined;
              return (
                <article key={offer._id}>
                  <strong>Your offer</strong>
                  <span>
                    {formatTons(offered.quantityKg)} {offered.materialType} for{" "}
                    {formatTons(requested.quantityKg)} {requested.materialType}
                  </span>
                  <span>{offer.status}</span>
                  {etaTarget && (
                    <span className="muted">
                      Expires: {formatCountdown(etaTarget, currentTime)}
                    </span>
                  )}
                  {offer.status === "open" && (
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
            {outgoingTrades.length === 0 && (
              <p className="muted">No offers sent yet.</p>
            )}
          </div>
        </section>
      )}
      {tab === "incoming" && (
        <section className={styles.incomingTradeBoard} aria-label="Incoming trade offers">
          <header>
            <span>Broker decisions</span>
            <h3>Incoming Trade Offer</h3>
          </header>
          {incomingTrades.map((offer: any) => {
            const sender = teamById.get(String(offer.offeringTeamId));
            const offered = offer.terms.offered.materials[0];
            const requested = offer.terms.requested.materials[0];
            const availableRequestedKg = availableForRequest(
              requested.materialType,
              requested.grade,
            );
            const canAccept = availableRequestedKg >= requested.quantityKg;
            return (
              <article className={styles.incomingTradeCard} key={offer._id}>
                <div className={styles.incomingTradeHeading}>
                  <span>From City {sender?.citySlot ?? "?"}{sender?.name ? ` · ${sender.name}` : ""}</span>
                  <strong>Expires {formatCountdown(offer.expiresAt, currentTime)}</strong>
                </div>
                <div className={styles.incomingTradeTerms}>
                  <div>
                    <span>They offer</span>
                    <strong>{formatTons(offered.quantityKg)} {offered.materialType} · Grade {offered.grade}</strong>
                  </div>
                  <div>
                    <span>They request</span>
                    <strong>{formatTons(requested.quantityKg)} {requested.materialType} · Grade {requested.grade}</strong>
                  </div>
                </div>
                <div className={styles.incomingTradeMeta}>
                  <span>{offer.terms.deliveryMode === "low-carbon" ? "Low carbon trade" : "Standard trade"}</span>
                  <span>You can provide {formatTons(availableRequestedKg)}</span>
                </div>
                <div className={styles.incomingTradeActions}>
                  <button
                    disabled={!canAccept}
                    onClick={() =>
                      void send(
                        `/v1/games/${gameId}/broker/trades/${offer._id}/accept`,
                        { payload: {} },
                      )
                    }
                    type="button"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() =>
                      void send(
                        `/v1/games/${gameId}/broker/trades/${offer._id}/reject`,
                        { payload: {} },
                      )
                    }
                    type="button"
                  >
                    Decline
                  </button>
                </div>
                {!canAccept && (
                  <p className={styles.tradeMaterialWarning}>
                    Not enough Grade {requested.grade} {requested.materialType} for this trade.
                  </p>
                )}
              </article>
            );
          })}
          {incomingTrades.length === 0 && (
            <p className="muted">No incoming trade offers right now.</p>
          )}
        </section>
      )}
    </section>
      ) : (
        <RoleInventoryPanel
          busy={busy}
          currentTime={currentTime}
          gameId={gameId}
          role="broker"
          send={send}
          team={team}
        />
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
function WarehouseOperations({ team }: { team: GameSnapshot["team"] }) {
  const materialTotals = materials.map((material) => ({
    material,
    totalKg:
      team.inventory[material].A +
      team.inventory[material].B +
      team.inventory[material].C,
  }));
  const totalKg = materialTotals.reduce((sum, entry) => sum + entry.totalKg, 0);
  let accumulatedPercent = 0;
  const pieGradient =
    totalKg > 0
      ? `conic-gradient(${materialTotals
          .map(({ material, totalKg: materialKg }) => {
            const start = accumulatedPercent;
            accumulatedPercent += (materialKg / totalKg) * 100;
            return `${materialColors[material]} ${start}% ${accumulatedPercent}%`;
          })
          .join(", ")})`
      : "conic-gradient(#355a58 0 100%)";
  return (
    <section className={`${styles.overlaySection} ${styles.warehouseDashboard}`}>
      <header className={styles.warehouseHeader}>
        <div>
          <span>Team material reserve</span>
          <h2>Shared Warehouse</h2>
        </div>
        <strong>{formatTons(totalKg)}</strong>
      </header>
      <section className={styles.warehouseAllocation} aria-label="Shared material allocation">
        <div className={styles.materialPie} style={{ background: pieGradient }}>
          <div>
            <span>Total stored</span>
            <strong>{formatTons(totalKg)}</strong>
          </div>
        </div>
        <div className={styles.materialLegend}>
          {materialTotals.map(({ material, totalKg: materialKg }) => {
            const percent = totalKg > 0 ? (materialKg / totalKg) * 100 : 0;
            return (
              <div data-material={material} key={material}>
                <span />
                <strong>{material}</strong>
                <b>{percent.toFixed(0)}%</b>
              </div>
            );
          })}
        </div>
      </section>
      <p className={styles.warehouseHint}>
        Project requirements use this team-wide stock. Material remains allocated to roles for transfers and trade.
      </p>
      <div className={styles.warehouseInventoryGrid}>
        {materials.map((material) => {
          const stock = team.inventory[material];
          const materialTotal = stock.A + stock.B + stock.C;
          return (
            <article data-material={material} key={material}>
              <div className={styles.materialCardHeading}>
                <img src={materialAsset[material]} alt="" />
                <span>{material}</span>
                <div>
                  <small>Shared total</small>
                  <strong>{formatTons(materialTotal)}</strong>
                </div>
              </div>
              <dl className={styles.materialGradeGrid}>
                {grades.map((grade) => (
                  <div key={grade}>
                    <dt>Grade {grade}</dt>
                    <dd>{formatTons(stock[grade])}</dd>
                  </div>
                ))}
              </dl>
              {stock.lockedKg > 0 && (
                <span className={styles.warehouseLocked}>
                  {formatTons(stock.lockedKg)} reserved in active trade
                </span>
              )}
            </article>
          );
        })}
      </div>
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
