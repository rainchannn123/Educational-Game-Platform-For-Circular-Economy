"use client";
import { FormEvent, useState } from "react";
import { api, command } from "../../lib/api";
import styles from "./facilitator.module.css";
export default function FacilitatorPage() {
  const [gameId, setGameId] = useState("");
  const [monitor, setMonitor] = useState<any>(null);
  const [message, setMessage] = useState("");
  async function load(event: FormEvent) {
    event.preventDefault();
    try {
      setMonitor(await api(`/v1/admin/games/${gameId}/monitor`));
      setMessage("Live monitor refreshed from authoritative state.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to access monitor.",
      );
    }
  }
  async function control(value: "pause" | "resume" | "end") {
    try {
      await command(`/v1/admin/games/${gameId}/${value}`, { payload: {} });
      setMessage(`Game ${value} command recorded.`);
      setMonitor(await api(`/v1/admin/games/${gameId}/monitor`));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Control was not applied.",
      );
    }
  }
  return (
    <main className="page">
      <p className={styles.eyebrow}>READ-ONLY CLASSROOM OBSERVATORY</p>
      <h1>Facilitator monitor</h1>
      <form className={styles.form} onSubmit={load}>
        <label>
          Game ID
          <input
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            required
          />
        </label>
        <button>Open monitor</button>
      </form>
      <p role="status">{message}</p>
      {monitor && (
        <>
          <section className={styles.controls}>
            <button onClick={() => control("pause")}>Pause game</button>
            <button onClick={() => control("resume")}>Resume game</button>
            <button className={styles.end} onClick={() => control("end")}>
              End game
            </button>
          </section>
          <section className={styles.grid}>
            <article className="card">
              <h2>Match state</h2>
              <p>{monitor.game.status}</p>
              <p>Project sequence {monitor.game.projectCursor}</p>
              <p>
                {
                  monitor.projects.filter(
                    (project: any) => project.status === "active",
                  ).length
                }{" "}
                active projects
              </p>
            </article>
            <article className="card">
              <h2>Material and resilience alerts</h2>
              <p>
                {monitor.teams.filter((team: any) => team.health < 20).length}{" "}
                cities need urgent City Care
              </p>
              <p>
                {
                  monitor.trades.filter((trade: any) => trade.status === "open")
                    .length
                }{" "}
                open trade offers
              </p>
              <p>{monitor.events.length} recent audit events loaded</p>
            </article>
          </section>
          <section className="card">
            <h2>City teams</h2>
            <div className={styles.table}>
              <div>
                <strong>City</strong>
                <strong>Wallet</strong>
                <strong>Health</strong>
                <strong>CO2</strong>
                <strong>Projects</strong>
              </div>
              {monitor.teams.map((team: any) => (
                <div key={team._id}>
                  <span>{team.citySlot}</span>
                  <span>
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                    }).format(team.walletCents / 100)}
                  </span>
                  <span>{team.health}%</span>
                  <span>{(team.totalCO2Kg / 1000).toFixed(1)} t</span>
                  <span>{team.metrics.projectsWon}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <h2>Audited event feed</h2>
            <ul className={styles.events}>
              {monitor.events.map((event: any) => (
                <li key={event._id}>
                  <time>{new Date(event.occurredAt).toLocaleTimeString()}</time>
                  <strong>{event.type}</strong>
                  <span>{event.teamId ?? "Game-wide"}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
