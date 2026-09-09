"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api } from "../../lib/api";
import styles from "./teams.module.css";
type Team = {
  _id: string;
  name: string;
  inviteCode: string;
  members: {
    userId: string;
    displayName: string;
    role?: string;
    ready: boolean;
  }[];
  status: string;
};
export default function TeamsPage() {
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState("");
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const createdTeam = await api<Team>("/v1/teams", {
        method: "POST",
        body: JSON.stringify({
          name: new FormData(event.currentTarget).get("name"),
        }),
      });
      setTeam(createdTeam);
      setError("");
      router.push(`/teams/${createdTeam._id}`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to make a team.",
      );
    }
  }
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const joinedTeam = await api<Team>("/v1/teams/join", {
        method: "POST",
        body: JSON.stringify({
          inviteCode: new FormData(event.currentTarget).get("inviteCode"),
        }),
      });
      setTeam(joinedTeam);
      setError("");
      router.push(`/teams/${joinedTeam._id}`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to join team.",
      );
    }
  }
  return (
    <main className="page">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>TEAM FORMATION</p>
          <h1>Choose your city team</h1>
          <p className="muted">
            Every city requires exactly one Municipality, MRF, and Broker
            player.
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {team ? (
        <section className={`card ${styles.team}`}>
          <h2>{team.name}</h2>
          <p>
            Invite code: <strong>{team.inviteCode}</strong>
          </p>
          <div className={styles.seats}>
            {team.members.map((member) => (
              <div key={member.userId} className={styles.seat}>
                <strong>{member.role ?? "Unassigned"}</strong>
                <span>{member.displayName}</span>
                <span>{member.ready ? "Ready" : "Planning"}</span>
              </div>
            ))}
          </div>
          <Link className={styles.primary} href={`/teams/${team._id}`}>
            Choose roles and continue
          </Link>
        </section>
      ) : (
        <div className={styles.forms}>
          <form className="card stack" onSubmit={create}>
            <h2>Start a city</h2>
            <label>
              City name
              <input
                name="name"
                required
                minLength={2}
                maxLength={50}
                placeholder=""
              />
            </label>
            <button className={styles.primary}>Create team</button>
          </form>
          <form className="card stack" onSubmit={join}>
            <h2>Join a city</h2>
            <label>
              City invite code
              <input
                name="inviteCode"
                required
                minLength={4}
                maxLength={6}
                autoCapitalize="characters"
                placeholder="A1B2C3"
              />
            </label>
            <button className={styles.secondary}>Join team</button>
          </form>
        </div>
      )}
    </main>
  );
}
