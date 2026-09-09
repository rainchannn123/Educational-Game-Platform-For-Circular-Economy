"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api";
import styles from "./results.module.css";
export default function ResultsPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const result = useQuery({
    queryKey: ["results", gameId],
    queryFn: () => api<any>(`/v1/games/${gameId}/results`),
  });
  if (result.isLoading)
    return <main className="page">Preparing debrief...</main>;
  if (result.isError)
    return (
      <main className="page" role="alert">
        Unable to load results.
      </main>
    );
  return (
    <main className="page">
      <p className={styles.eyebrow}>FACILITATED DEBRIEF</p>
      <h1>City results</h1>
      <p>
        Rank is determined by final wallet. CO2, City Health, and final claim
        time break ties.
      </p>
      <ol className={styles.ranking}>
        {result.data.teams.map((team: any) => (
          <li className="card" key={team._id}>
            <strong>
              #{team.rank} City {team.citySlot}
            </strong>
            <span>
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(team.walletCents / 100)}
            </span>
            <span>{(team.totalCO2Kg / 1000).toFixed(1)} tCO2e</span>
            <span>{team.health}% health</span>
            <span>{team.metrics.projectsWon} projects won</span>
          </li>
        ))}
      </ol>
      <section className="card">
        <h2>Reflection prompts</h2>
        <p>
          Which source of material supported your most valuable project? When
          did a fast choice increase carbon pressure? How did City Care change
          the options available to your team?
        </p>
      </section>
    </main>
  );
}
