"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { io, type Socket } from "socket.io-client";
import { useEffect, useRef, useState } from "react";
import type { Material, Role } from "@circular-city/contracts";
import { HEALTH_MISSIONS, MATERIALS } from "@circular-city/game-content";
import { api, command, getToken } from "../lib/api";
import styles from "./GameScreen.module.css";
type Snapshot = any;
const apiBase = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000";
const formatMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );
const formatTons = (kg: number) => `${((kg ?? 0) / 1000).toFixed(1)} t`;
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
export function GameScreen({
  gameId,
  routeRole,
}: {
  gameId: string;
  routeRole: Role;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [chat, setChat] = useState("");
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [commandBusy, setCommandBusy] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const sendLockRef = useRef(false);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const snapshot = useQuery({
    queryKey: ["snapshot", gameId],
    queryFn: () => api<Snapshot>(`/v1/games/${gameId}/snapshot`),
    refetchInterval: 12000,
  });
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
    const sync = () =>
      queryClient.invalidateQueries({ queryKey: ["snapshot", gameId] });
    [
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
    ].forEach((event) => socket.on(event, sync));
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
  }, [gameId, queryClient]);
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
          <Link href={`/games/${gameId}/results`}>Open results and reflection</Link>
        </section>
      </main>
    );
  const team = data.team;
  const displayServerTime =
    data.game.serverTime + Math.max(0, clock - snapshot.dataUpdatedAt);
  const send = async (
    path: string,
    payload: object,
    method = "POST",
  ): Promise<boolean> => {
    if (sendLockRef.current || commandBusy) {
      setNotice("Previous action still processing. Please wait for confirmation.");
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
            setNotice("This match has finished. Open the results screen for the debrief.");
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
              setNotice("This listing is no longer active. Syncing latest project rail.");
              await queryClient.invalidateQueries({ queryKey: ["snapshot", gameId] });
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
          await queryClient.invalidateQueries({ queryKey: ["snapshot", gameId] });
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
            await queryClient.invalidateQueries({ queryKey: ["snapshot", gameId] });
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
  return (
    <main className={`page ${styles.gameShell}`} data-role={routeRole}>
      <header className={styles.header}>
        <div className={styles.metrics}>
          <Metric label="Wallet" value={formatMoney(team.walletCents)} icon="wallet" />
          <Metric
            label="City Health"
            value={`${team.health}%`}
            tone={
              team.health < 20
                ? "danger"
                : team.health <= 50
                  ? "urgent"
                  : "stable"
            }
            icon="health"
          />
          <Metric label="CO2" value={formatTons(team.totalCO2Kg)} icon="co2" />
          <Metric
            label="Link"
            value={connected ? "Connected" : "Syncing"}
            icon="circular-economy-loop"
          />
        </div>
        <div className={styles.matchStatus} aria-label="Match status">
          <img className={styles.roleAvatar} src={roleAvatar[routeRole]} alt="" />
          <span className={styles.playerRole}>{roleLabel}</span>
          <strong>
            <img className={styles.timerIcon} src={asset("countdown")} alt="" />
            {countdownTarget
              ? formatCountdown(countdownTarget, displayServerTime)
              : "--:--"}
          </strong>
          <span>
            {data.game.status === "finalizing"
              ? "Finalization"
              : data.game.status === "active"
                ? "Round active"
                : "Briefing"}
          </span>
        </div>
      </header>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      <section className={styles.projectRail} aria-labelledby="rail-title">
        <div className={styles.sectionHeader}>
          <h2 id="rail-title">Projects</h2>
          <span>
            {data.projects.active.length} active, {data.projects.queued.length}{" "}
            queued
          </span>
        </div>
        <div className={styles.rail}>
          {[
            ...data.projects.active,
            ...data.projects.queued,
            ...data.projects.preview,
          ].map((project: any) => (
            <article
              className={styles.project}
              key={project._id}
              data-state={project.status}
            >
              <img className={styles.projectBadge} src={asset("badge")} alt="" />
              {project.sequence === 1 && (
                <img className={styles.openingProject} src={asset("one")} alt="Opening project" />
              )}
              <p>
                {project.status.toUpperCase()} · Tier {project.template.tier}
              </p>
              <h3>{project.template.title}</h3>
              <p>{project.template.context}</p>
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
              <p>
                Gross {formatMoney(project.template.grossRevenueCents)} ·{" "}
                {project.template.co2ImpactKg < 0 ? "Avoids" : "Adds"}{" "}
                {formatTons(Math.abs(project.template.co2ImpactKg))} CO2e
              </p>
              {project.status === "announced" && (
                <p>
                  Arrives in {formatCountdown(project.announcementAt, displayServerTime)}
                </p>
              )}
              {project.status === "queued" && (
                <p>Queued until one active project is claimed or expires.</p>
              )}
              {project.status === "active" && (
                <p data-state="urgent">
                  <img className={styles.sparkle} src={asset("leaf-sparkle")} alt="" />
                  {formatCountdown(project.expiresAt, displayServerTime)} to claim
                </p>
              )}
              {project.status === "active" && (
                <button
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
              )}
            </article>
          ))}
        </div>
      </section>
      <ProjectHistoryNotes
        projects={data.projects.recentlyClosed}
        teamLabelById={teamLabelById}
      />
      <div className={styles.layout}>
        <section className={`card ${styles.workstation}`}>
          <h2>{workspaceTitle}</h2>
          {routeRole === "municipality" && (
            <Municipality
              team={team}
              gameId={gameId}
              send={send}
              busy={commandBusy}
              currentTime={displayServerTime}
            />
          )}
          {routeRole === "mrf" && (
            <Mrf team={team} gameId={gameId} send={send} busy={commandBusy} />
          )}
          {routeRole === "broker" && (
            <Broker
              team={team}
              gameId={gameId}
              teams={data.publicLeaderboard}
              trades={data.trades}
              send={send}
              busy={commandBusy}
            />
          )}
        </section>
        <aside className="stack">
          <TeamOperations
            team={team}
            mission={team.currentHealthMission}
            gameId={gameId}
            role={routeRole}
            send={send}
            busy={commandBusy}
            currentTime={displayServerTime}
          />
          <Communication
            gameId={gameId}
            chat={chat}
            setChat={setChat}
            send={send}
            busy={commandBusy}
            messages={data.chatMessages ?? []}
          />
        </aside>
      </div>
    </main>
  );
}
function Metric({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon: string;
}) {
  return (
    <div data-state={tone}>
      <img className={styles.metricIcon} src={asset(icon)} alt="" />
      <span>{label}</span>
      <strong>{value}</strong>
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
  return (
    <>
      <div className={styles.queue}>
        {transitSources.map((source: any) => (
          <article key={source._id}>
            <strong className={styles.batchTitle}>
              <img src={asset("material-bale")} alt="" />
              {formatTons(source.massKg)} waste batch in transit
            </strong>
            <span>
              <img className={styles.timerIcon} src={asset("countdown")} alt="" />
              Delivering to MRF in{" "}
              {source.transitArrivesAt
                ? formatCountdown(source.transitArrivesAt, currentTime)
                : "0:00"}
            </span>
            <span className="muted">Batch is locked until arrival at MRF queue.</span>
          </article>
        ))}
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
              Expires {new Date(source.expiresAt).toLocaleTimeString()}
            </span>
            <span>
              Expected mix: {materials
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
}: {
  team: any;
  gameId: string;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
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
                    <strong>{String(guide.mode).toUpperCase()}</strong> · {Math.floor((guide.durationMs ?? 0) / 1000)}s ·
                    cost {formatMoney(guide.totalCostCents ?? 0)} · CO2 {formatTons(guide.totalCO2Kg ?? 0)} ·
                    recover {formatTons(guide.recoveredKg ?? 0)} ({((guide.recoveryRateBasisPoints ?? 0) / 100).toFixed(1)}%) ·
                    residue {formatTons(guide.residueKg ?? 0)}
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
            Processing in progress until{" "}
            {new Date(job.dueAt).toLocaleTimeString()}.
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
}: {
  team: any;
  gameId: string;
  teams: { teamId: string; citySlot: number; name?: string }[];
  trades: unknown[] | undefined;
  send: (path: string, payload: object, method?: string) => Promise<boolean>;
  busy: boolean;
}) {
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
  const externalCostCents = quantity * MATERIALS[material].externalPriceCentsPerKg;
  const externalCo2Kg = Math.round(
    (quantity * MATERIALS[material].externalCO2MilliKgPerKg) / 1000,
  );
  const availableOfferKg = Math.max(
    0,
    team.inventory[material].B - (team.inventory[material].lockedB ?? 0),
  );
  const validQuantity =
    Number.isFinite(quantity) && quantity >= 100 && quantity % 100 === 0;

  return (
    <>
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
          Purchase {formatTons(quantity)} for {formatMoney(externalCostCents)} · +{formatTons(externalCo2Kg)} CO2e
        </button>
      </div>
      <section className={styles.tradeBoard} aria-label="Broker trade board">
        <div>
          <h3>Propose a material trade</h3>
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
            <option value="low-carbon">Low carbon: 15s · $25 · 0.15 tCO2e</option>
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
            busy || !recipientTeamId || !validQuantity || availableOfferKg < quantity
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
          {(trades ?? []).map((offer: any) => {
            const incoming = offer.recipientTeamId === team.teamId;
            const offered = offer.terms.offered.materials[0];
            const requested = offer.terms.requested.materials[0];
            return (
              <article key={offer._id}>
                <strong>{incoming ? "Incoming offer" : "Your offer"}</strong>
                <span>
                  {offered.quantityKg} kg {offered.materialType} for{" "}
                  {requested.quantityKg} kg {requested.materialType}
                </span>
                <span>{offer.status}</span>
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
    </>
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
    <section className={`card ${styles.historyNotes}`}>
      <h2>Project history notes</h2>
      <ul className={styles.historyList}>
        {recent.length ? (
          recent.map((project) => {
            const winner = project.winnerTeamId
              ? teamLabelById.get(String(project.winnerTeamId)) ??
                "Unknown city"
              : "No winning city";
            const netRevenue =
              project.awardReceipt?.netRevenueCents ??
              project.template?.grossRevenueCents;
            return (
              <li key={project._id} className={styles.historyItem}>
                <strong>
                  {project.template.title} ({project.status})
                </strong>
                <span>
                  {project.status === "claimed"
                    ? `${winner} completed it · net ${formatMoney(netRevenue)} · CO2 ${project.template.co2ImpactKg < 0 ? "avoids" : "adds"} ${formatTons(Math.abs(project.template.co2ImpactKg))}`
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
            <span>Claimed and expired projects will appear here as short audit notes.</span>
          </li>
        )}
      </ul>
    </section>
  );
}
function TeamOperations({
  team,
  mission,
  gameId,
  role,
  send,
  busy,
  currentTime,
}: {
  team: any;
  mission: any;
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
  const selectedOption = myStep
    ? missionTemplate?.options?.[role]?.find(
        (option) => option.key === myStep.optionKey,
      )
    : undefined;
  return (
    <section className="card">
      <h2>Team Operations</h2>
      <h3>Shared inventory</h3>
      <dl className={styles.inventory}>
        {materials.map((material) => (
          <div key={material}>
            <dt>
              <img src={materialAsset[material]} alt="" />
              {material}
            </dt>
            <dd>
              A {formatTons(team.inventory[material].A)} · B{" "}
              {formatTons(team.inventory[material].B)} · C{" "}
              {formatTons(team.inventory[material].C)}
              {team.inventory[material].lockedKg
                ? ` · Locked ${formatTons(team.inventory[material].lockedKg)}`
                : ""}
            </dd>
          </div>
        ))}
      </dl>
      <h3>Role Quiz</h3>
      {mission ? (
        <div>
          <p>
            <strong>{missionTemplate?.title ?? mission.templateId}</strong>
          </p>
          <p className="muted">
            {question}
          </p>
          <p className="muted">
            Answer in {secondsRemaining}s. Correct answer boosts city health; wrong answer reduces it.
          </p>
          {myStep ? (
            <p className="muted">
              Your answer is submitted{selectedOption ? `: ${selectedOption.label}` : ""}. Waiting for teammates.
            </p>
          ) : (
            <div className={styles.missionChoices}>
              {missionTemplate?.options?.[role]?.map((option) => (
                <button
                  key={option.key}
                  disabled={busy}
                  onClick={() =>
                    void send(
                      `/v1/games/${gameId}/health-missions/${mission._id}/steps`,
                      { payload: { optionKey: option.key } },
                    )
                  }
                >
                  {option.label}
                </button>
              ))}
              {!missionTemplate?.options?.[role]?.length && (
                <p className="muted">Quiz options are synchronizing...</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="muted">Preparing your next 20-second role quiz...</p>
      )}
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
  messages: Array<{ _id: string; senderRole: string; content: string; createdAtMs: number }>;
}) {
  return (
    <section className="card">
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
      <div className={styles.chatHistory} aria-live="polite" aria-label="Team messages">
        {messages.length ? (
          messages.map((message) => (
            <p key={message._id}>
              <strong>{message.senderRole}</strong> <span>{message.content}</span>
            </p>
          ))
        ) : (
          <p className="muted">No messages yet. Use pings for quick hand-offs.</p>
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
