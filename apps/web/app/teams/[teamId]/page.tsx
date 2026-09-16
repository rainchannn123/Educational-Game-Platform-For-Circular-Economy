"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, getToken } from "../../../lib/api";
import styles from "./team.module.css";
type Role = "municipality" | "mrf" | "broker";
type Team = {
  _id: string;
  name: string;
  inviteCode: string;
  leaderUserId: string;
  members: {
    userId: string;
    displayName: string;
    role?: Role;
    ready: boolean;
  }[];
  status: string;
  matchRoom?: {
    name: string;
    status: string;
    gameId: string | null;
    gameStatus: string | null;
  } | null;
};

type CurrentUser = {
  id: string;
};
const descriptions: Record<Role, string> = {
  municipality:
    "Collect waste, select low-carbon routes, approve project sites, and submit civic projects.",
  mrf: "Recover material, choose quality and residue pathways, and certify project material.",
  broker:
    "Balance external procurement, negotiated trades, and project delivery budgets.",
};
export default function TeamDetail() {
  const { teamId } = useParams<{ teamId: string }>();
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [message, setMessage] = useState("");
  const loadingRef = useRef(false);
  const currentUserRef = useRef<CurrentUser | null>(null);
  const load = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [nextTeam, user] = await Promise.all([
        api<Team>(`/v1/teams/${teamId}`),
        currentUserRef.current
          ? Promise.resolve(currentUserRef.current)
          : api<CurrentUser | null>("/v1/me"),
      ]);
      setTeam(nextTeam);
      setCurrentUser(user);
      currentUserRef.current = user;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load team.",
      );
    } finally {
      loadingRef.current = false;
    }
  };
  useEffect(() => {
    load();
  }, [teamId]);
  const gameRole = team?.members.find(
    (member) => member.userId === currentUser?.id,
  )?.role;

  useEffect(() => {
    if (team?.matchRoom?.gameId && gameRole) {
      router.replace(`/games/${team.matchRoom.gameId}/${gameRole}`);
    }
  }, [gameRole, router, team?.matchRoom?.gameId]);

  useEffect(() => {
    const socket = io(
      process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000",
      {
        auth: { token: getToken() },
        transports: ["websocket"],
        autoConnect: false,
        reconnectionAttempts: 6,
        reconnectionDelay: 600,
        reconnectionDelayMax: 4_000,
      },
    );
    const refresh = () => void load();
    let connectTimeout: number | null = null;
    const connectIfVisible = () => {
      if (document.visibilityState !== "visible" || socket.connected) return;
      if (connectTimeout !== null) window.clearTimeout(connectTimeout);
      connectTimeout = window.setTimeout(() => {
        connectTimeout = null;
        if (document.visibilityState === "visible" && !socket.connected)
          socket.connect();
      }, 50);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (connectTimeout !== null) {
          window.clearTimeout(connectTimeout);
          connectTimeout = null;
        }
        socket.disconnect();
      }
      else connectIfVisible();
    };

    socket.on("connect", () => {
      socket.emit("socket.join-team", { teamId });
    });
    socket.on("team.updated", refresh);

    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !socket.connected) refresh();
    }, 10_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    connectIfVisible();
    return () => {
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (connectTimeout !== null) window.clearTimeout(connectTimeout);
      socket.close();
    };
  }, [teamId]);
  async function role(value: Role) {
    try {
      await api(`/v1/teams/${teamId}/roles`, {
        method: "POST",
        body: JSON.stringify({ role: value }),
      });
      setMessage("Role selection synchronized.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to select role.",
      );
    }
  }
  async function ready() {
    try {
      await api(`/v1/teams/${teamId}/ready`, { method: "POST", body: "{}" });
      setMessage("Readiness saved.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to set readiness.",
      );
    }
  }
  if (!team)
    return (
      <main className="page">
        <p>Loading team room...</p>
      </main>
    );
  const currentMember = team.members.find(
    (member) => member.userId === currentUser?.id,
  );
  const readyCount = team.members.filter((member) => member.ready).length;
  const rolesSelected = team.members.filter((member) => member.role).length;

  return (
    <main className="page">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CITY TEAM ROOM</p>
          <h1>{team.name}</h1>
          <p className="muted">
            Invite teammates with <strong>{team.inviteCode}</strong>. Select one
            distinct role, then confirm readiness.
          </p>
        </div>
      </header>
      <p role="status" className="muted">
        {message}
      </p>
      <section className={styles.roles} aria-label="Role selection">
        {(Object.keys(descriptions) as Role[]).map((value) => {
          const member = team.members.find((item) => item.role === value);
          return (
            <article className="card" key={value}>
              <p className={styles.role}>{value.toUpperCase()}</p>
              <h2>{value === "mrf" ? "Materials Recovery Facility" : value}</h2>
              <p>{descriptions[value]}</p>
              <p className="muted">
                {member ? `${member.displayName} is assigned` : "Open seat"}
              </p>
              <button disabled={Boolean(member)} onClick={() => role(value)}>
                Select {value}
              </button>
            </article>
          );
        })}
      </section>
      <section className={`card ${styles.checklist}`}>
        <h2>Press Ready to if you are prepared to start the game!</h2>
        <div
          className={styles.readinessGrid}
          aria-label="Team readiness progress"
        >
          {team.members.map((member) => (
            <div key={member.userId} className={styles.readinessMember}>
              <strong>{member.displayName}</strong>
              <span>{member.role ?? "Role not selected"}</span>
              <span data-state={member.ready ? "stable" : "urgent"}>
                {member.ready ? "Ready" : "Not ready"}
              </span>
            </div>
          ))}
        </div>
        <button onClick={ready} disabled={currentMember?.ready}>
          {currentMember?.ready ? "You are ready" : "I am ready"}
        </button>
        {team.status === "ready" &&
          team.leaderUserId === currentUser?.id &&
          !team.matchRoom && (
            <Link className={styles.roomAction} href="/rooms">
              Find or create a match room
            </Link>
          )}
        {team.matchRoom && (
          <p className={styles.roomStatus} data-state="stable">
            Your city has joined <strong>{team.matchRoom.name}</strong>.
            {team.matchRoom.gameId && currentMember?.role && (
              <Link
                href={`/games/${team.matchRoom.gameId}/${currentMember.role}`}
              >
                Enter your role workstation
              </Link>
            )}
          </p>
        )}
        <p data-state={team.status === "ready" ? "stable" : "urgent"}>
          {team.status === "ready"
            ? "All roles are ready. Your team leader can enter a room."
            : `${readyCount}/3 teammates ready. ${rolesSelected}/3 roles selected.`}
        </p>
      </section>
    </main>
  );
}
