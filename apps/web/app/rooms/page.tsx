"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import styles from "./rooms.module.css";

type Team = {
  _id: string;
  name: string;
  status: string;
  leaderUserId: string;
  members: { userId: string; role?: string }[];
  matchRoom?: {
    gameId: string | null;
    gameStatus: string | null;
  } | null;
};
type Room = {
  _id: string;
  code: string;
  name: string;
  ownerUserId: string;
  maxTeams: number;
  seating: { teamId: string; citySlot: number }[];
  seatedTeams: { teamId: string; citySlot: number; name: string }[];
};
type CurrentUser = { id: string };

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [leaderTeam, setLeaderTeam] = useState<Team | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();

  const load = async () => {
    try {
      const [nextRooms, teams, user] = await Promise.all([
        api<Room[]>("/v1/rooms"),
        api<Team[]>("/v1/teams/mine"),
        api<CurrentUser | null>("/v1/me"),
      ]);
      setRooms(nextRooms);
      setCurrentUserId(user?.id ?? "");
      const nextLeaderTeam = teams.find(
        (team) =>
          ["ready", "in-room"].includes(team.status) &&
          team.leaderUserId === user?.id,
      );
      if (!nextLeaderTeam) {
        setLeaderTeam(null);
        return;
      }
      const detailedTeam = await api<Team>(`/v1/teams/${nextLeaderTeam._id}`);
      const role = detailedTeam.members.find(
        (member) => member.userId === user?.id,
      )?.role;
      if (detailedTeam.matchRoom?.gameId && role) {
        router.replace(`/games/${detailedTeam.matchRoom.gameId}/${role}`);
        return;
      }
      setLeaderTeam(detailedTeam);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load rooms.",
      );
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!leaderTeam) return;
    try {
      const form = new FormData(event.currentTarget);
      const room = await api<Room>("/v1/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          maxTeams: Number(form.get("maxTeams")),
          teamId: leaderTeam._id,
        }),
      });
      setMessage(`Created ${room.name}; your city is seated in it.`);
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to create room.",
      );
    }
  }

  async function seat(room: Room, action: "join" | "quit") {
    if (!leaderTeam) return;
    try {
      await api(`/v1/rooms/${room.code}/${action}`, {
        method: "POST",
        body: JSON.stringify({ teamId: leaderTeam._id }),
      });
      setMessage(
        action === "join"
          ? `Your city joined ${room.name}.`
          : `Your city left ${room.name}.`,
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update room seating.",
      );
    }
  }

  async function start(room: Room) {
    try {
      const result = await api<{ gameId: string }>(
        `/v1/rooms/${room.code}/start`,
        {
          method: "POST",
          body: "{}",
        },
      );
      router.push(`/games/${result.gameId}/municipality`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to start the game.",
      );
    }
  }

  return (
    <main className="page">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MATCH ROOMS</p>
          <h1>Choose your city challenge</h1>
          <p className="muted">
            The city team leader seats a ready city in a match room. Every role
            enters its own live workstation when the match starts.
          </p>
        </div>
      </header>
      <p role="status">{message}</p>
      {leaderTeam ? (
        <section className={styles.grid}>
          <form className="card stack" onSubmit={create}>
            <p className={styles.eyebrow}>TEAM LEADER</p>
            <h2>Create and enter a public room</h2>
            <p className="muted">You are bringing {leaderTeam.name}.</p>
            <label>
              Name
              <input name="name" required defaultValue="Circular City Studio" />
            </label>
            <label>
              Maximum city teams
              <select name="maxTeams" defaultValue="6">
                <option value="2">2</option>
                <option value="6">6</option>
                <option value="12">12</option>
                <option value="30">30</option>
              </select>
            </label>
            <button>Create room</button>
          </form>
        </section>
      ) : (
        <section className="card">
          <h2>Team leadership required</h2>
          <p className="muted">
            Return to your city team room. Once all three roles are ready, the
            player who created the city can choose a match room here.
          </p>
        </section>
      )}
      <section className={styles.list} aria-live="polite">
        {rooms.map((room) => {
          const seated = Boolean(
            leaderTeam &&
            room.seating.some((seat) => seat.teamId === leaderTeam._id),
          );
          const canStart =
            room.ownerUserId === currentUserId && room.seating.length >= 2;
          return (
            <article className="card" key={room._id}>
              <div>
                <h2>{room.name}</h2>
                <p className="muted">
                  Room {room.code} · {room.seating.length}/{room.maxTeams} city
                  teams seated
                </p>
                <div className={styles.seatGrid}>
                  {Array.from({ length: room.maxTeams }, (_, index) => {
                    const seat = room.seatedTeams.find(
                      (item) => item.citySlot === index + 1,
                    );
                    return (
                      <span key={index} data-state={seat ? "stable" : "empty"}>
                        {seat ? seat.name : "Open city slot"}
                      </span>
                    );
                  })}
                </div>
              </div>
              {seated ? (
                <div className={styles.roomActions}>
                  <button
                    className={styles.quit}
                    onClick={() => void seat(room, "quit")}
                  >
                    Quit room
                  </button>
                  {canStart && (
                    <button onClick={() => void start(room)}>Start game</button>
                  )}
                </div>
              ) : (
                <button
                  disabled={!leaderTeam || leaderTeam.status !== "ready"}
                  onClick={() => void seat(room, "join")}
                >
                  Join room
                </button>
              )}
            </article>
          );
        })}
        {rooms.length === 0 && (
          <p className="muted">
            No waiting rooms yet. Create the first one above.
          </p>
        )}
      </section>
    </main>
  );
}
