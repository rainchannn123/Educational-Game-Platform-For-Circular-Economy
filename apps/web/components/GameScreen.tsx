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
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [readinessValue, setReadinessValue] = useState(
    routeRole === "municipality"
      ? "standard-delivery"
      : routeRole === "mrf"
        ? "grade-b-bundle"
        : "recovered-first",
  );
  const socketRef = useRef<Socket | null>(null);
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
    });
    socketRef.current = socket;
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
    socket.on("connect_error", () =>
      setConnected(false),
    );
    socket.on("connect_error", () =>
      setNotice(
        "Reconnecting. Commands are disabled until the latest snapshot arrives.",
      ),
    );
    return () => {
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
  const send = async (path: string, payload: object, method = "POST") => {
    try {
      const authoritativeSnapshot = await queryClient.fetchQuery({
        queryKey: ["snapshot", gameId],
        queryFn: () => api<Snapshot>(`/v1/games/${gameId}/snapshot`),
      });

      if (authoritativeSnapshot.game.status === "completed") {
        setNotice("This match has finished. Open the results screen for the debrief.");
        return;
      }
      const isProjectFinalizationAction = /\/projects\/[^/]+\/(readiness|claim)$/.test(
        path,
      );
      const isCommunicationAction = /\/(chat\/messages|pings)$/.test(path);
      if (
        authoritativeSnapshot.game.status !== "active" &&
        !(
          authoritativeSnapshot.game.status === "finalizing" &&
          (isProjectFinalizationAction || isCommunicationAction)
        )
      ) {
        setNotice(
          authoritativeSnapshot.game.status === "finalizing"
            ? "Finalization only accepts project delivery and team communication."
            : "The match is still in briefing. Actions unlock when play begins.",
        );
        return;
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
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Command could not be completed.",
      );
    }
  };
  const activeProject =
    data.projects.active.find((project: any) => project._id === selectedProjectId) ??
    data.projects.active[0];
  const activeProjectWork = activeProject
    ? data.teamProjectWork.find(
        (work: any) => work.projectId === activeProject._id,
      )
    : undefined;
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
              {project.status === "active" && (
                <p data-state="urgent">
                  <img className={styles.sparkle} src={asset("leaf-sparkle")} alt="" />
                  {formatCountdown(project.expiresAt, displayServerTime)} to claim
                </p>
              )}
              {project.status === "active" && (
                <button
                  aria-pressed={activeProject?._id === project._id}
                  onClick={() => setSelectedProjectId(project._id)}
                >
                  {activeProject?._id === project._id
                    ? "Viewing project"
                    : "Review this project"}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
      <div className={styles.layout}>
        <section className={`card ${styles.workstation}`}>
          <h2>{workspaceTitle}</h2>
          {routeRole === "municipality" && (
            <Municipality team={team} gameId={gameId} send={send} />
          )}
          {routeRole === "mrf" && (
            <Mrf team={team} gameId={gameId} send={send} />
          )}
          {routeRole === "broker" && (
            <Broker
              team={team}
              gameId={gameId}
              teams={data.publicLeaderboard}
              trades={data.trades}
              send={send}
            />
          )}
          {activeProject && (
            <section className={styles.dock}>
              <h3>Project delivery dock</h3>
               <p>
                 {activeProject.template.title} needs all three readiness checks
                 before Municipal submission.
               </p>
               <div className={styles.readiness} aria-label="Role readiness">
                 {[
                   ["Municipality", activeProjectWork?.municipalityReady],
                   ["MRF", activeProjectWork?.mrfReady],
                   ["Broker", activeProjectWork?.brokerReady],
                 ].map(([label, complete]) => (
                   <span key={String(label)} data-state={complete ? "complete" : "pending"}>
                     {complete ? "Ready" : "Waiting"}: {label}
                   </span>
                 ))}
               </div>
               <button
                onClick={() =>
                  send(
                    `/v1/games/${gameId}/projects/${activeProject._id}/material-plan`,
                    {
                      expectedWorkRevision:
                        data.teamProjectWork.find(
                          (work: any) => work.projectId === activeProject._id,
                        )?.workRevision ?? 0,
                      payload: {
                        materials: activeProject.template.requirementsKg,
                      },
                    },
                    "PUT",
                  )
                }
                >
                  Save exact material plan
                </button>
               <label className={styles.readinessSelect}>
                 Your delivery decision
                 <select
                   value={readinessValue}
                   onChange={(event) => setReadinessValue(event.target.value)}
                 >
                   {routeRole === "municipality" && (
                     <>
                       <option value="standard-delivery">Standard delivery</option>
                       <option value="low-carbon-delivery">Low-carbon delivery</option>
                     </>
                   )}
                   {routeRole === "mrf" && (
                     <>
                       <option value="grade-b-bundle">Certify grade A/B bundle</option>
                       <option value="grade-a-bundle">Certify grade A only</option>
                     </>
                   )}
                   {routeRole === "broker" && (
                     <>
                       <option value="recovered-first">Recovered-first plan</option>
                       <option value="trade-supported">Trade-supported plan</option>
                       <option value="external-supported">External-supported plan</option>
                     </>
                   )}
                 </select>
               </label>
              <button
                onClick={() =>
                  send(
                    `/v1/games/${gameId}/projects/${activeProject._id}/readiness/${routeRole}`,
                    { payload: { value: readinessValue } },
                  )
                }
              >
                Confirm {routeRole} readiness
              </button>
                {routeRole === "municipality" && (
                <button
                  className={styles.claim}
                  onClick={() =>
                    send(
                      `/v1/games/${gameId}/projects/${activeProject._id}/claim`,
                      {
                        expectedTeamRevision: team.revision,
                        payload: { confirm: true },
                      },
                    )
                  }
                >
                    Claim project atomically
                  </button>
                )}
            </section>
          )}
        </section>
        <aside className="stack">
          <TeamOperations
            team={team}
            mission={team.currentHealthMission}
            gameId={gameId}
            role={routeRole}
            send={send}
          />
          <Communication
            gameId={gameId}
            chat={chat}
            setChat={setChat}
            send={send}
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
}: {
  team: any;
  gameId: string;
  send: (path: string, payload: object) => void;
}) {
  const availableSources = team.wasteSources.filter(
    (source: any) => source.status === "available",
  );
  return (
    <>
      <div className={styles.queue}>
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
                onClick={() =>
                  send(`/v1/games/${gameId}/municipality/collections`, {
                    expectedTeamRevision: team.revision,
                    payload: { wasteSourceId: source._id, route: "express" },
                  })
                }
              >
                Express: 6s · $0.07/kg · 0.36 CO2/kg
              </button>
              <button
                onClick={() =>
                  send(`/v1/games/${gameId}/municipality/collections`, {
                    expectedTeamRevision: team.revision,
                    payload: { wasteSourceId: source._id, route: "standard" },
                  })
                }
              >
                Standard: 10s · $0.045/kg · 0.18 CO2/kg
              </button>
              <button
                onClick={() =>
                  send(`/v1/games/${gameId}/municipality/collections`, {
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
}: {
  team: any;
  gameId: string;
  send: (path: string, payload: object) => void;
}) {
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
                      onClick={() =>
                        send(`/v1/games/${gameId}/mrf/processes`, {
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
}: {
  team: any;
  gameId: string;
  teams: { teamId: string; citySlot: number }[];
  trades: unknown[] | undefined;
  send: (path: string, payload: object) => void;
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
          disabled={!validQuantity}
          onClick={() =>
            send(`/v1/games/${gameId}/broker/external-purchases`, {
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
          disabled={!recipientTeamId || !validQuantity || availableOfferKg < quantity}
          onClick={() =>
            send(`/v1/games/${gameId}/broker/trades`, {
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
                      onClick={() =>
                        send(
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
                      onClick={() =>
                        send(
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
                    onClick={() =>
                      send(
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
function TeamOperations({
  team,
  mission,
  gameId,
  role,
  send,
}: {
  team: any;
  mission: any;
  gameId: string;
  role: Role;
  send: (path: string, payload: object) => void;
}) {
  const missionTemplate = mission
    ? HEALTH_MISSIONS.find((template) => template.id === mission.templateId)
    : undefined;
  const myStep = mission?.steps?.[role];
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
      <h3>City Care</h3>
      {mission ? (
        <div>
          <p>
            <strong>{missionTemplate?.title ?? mission.templateId}</strong> needs every role before{" "}
            {new Date(mission.expiresAt).toLocaleTimeString()}.
          </p>
          <p className="muted">
            {missionTemplate?.explanation ?? "Choose the circular response that best protects city wellbeing."}
          </p>
          {myStep ? (
            <p className="muted">Your role has submitted a City Care response.</p>
          ) : (
            <div className={styles.missionChoices}>
              {missionTemplate?.options[role].map((option) => (
                <button
                  key={option.key}
                  onClick={() =>
                    send(
                      `/v1/games/${gameId}/health-missions/${mission._id}/steps`,
                      { payload: { optionKey: option.key } },
                    )
                  }
                >
                  {option.label}
                  {option.highImpact ? " · +impact" : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="muted">No unresolved City Care mission.</p>
      )}
    </section>
  );
}
function Communication({
  gameId,
  chat,
  setChat,
  send,
  messages,
}: {
  gameId: string;
  chat: string;
  setChat: (value: string) => void;
  send: (path: string, payload: object) => void;
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
            onClick={() =>
              send(`/v1/games/${gameId}/pings`, { payload: { type } })
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
        disabled={!chat.trim()}
        onClick={() => {
          send(`/v1/games/${gameId}/chat/messages`, {
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
