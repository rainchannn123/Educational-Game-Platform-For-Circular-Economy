"use client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api, setToken } from "../lib/api";
import styles from "./page.module.css";

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const data = await api<{ token: string }>(
        `/v1/auth/${mode === "sign-in" ? "sign-in" : "sign-up"}`,
        {
          method: "POST",
          body: JSON.stringify({
            displayName: form.get("displayName"),
            email: form.get("email"),
            password: form.get("password"),
          }),
        },
      );
      setToken(data.token);
      router.push("/teams");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to continue.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={`page ${styles.hero}`}>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>REAL-TIME CIRCULAR ECONOMY SIMULATION</p>
        <h1>Clash of the Cities</h1>
        <p>
          Build a city where recovery, care, and smart procurement turn waste
          into lasting civic value.
        </p>
        <ul>
          <li>Three connected roles: Municipality, MRF, Broker</li>
          <li>Universal 20-second civic-project races</li>
          <li>Wallet ranking with visible carbon and resilience trade-offs</li>
        </ul>
      </section>
      <section className={`card ${styles.auth}`} aria-labelledby="auth-title">
        <h2 id="auth-title">
          {mode === "sign-in"
            ? "Log In to your player profile"
            : "Create your player profile"}
        </h2>
        <form className="stack" onSubmit={submit}>
          {mode === "sign-up" && (
            <label>
              Display name
              <input required name="displayName" autoComplete="name" />
            </label>
          )}
          <label>
            Username
            <input required name="email" type="text" autoComplete="username" />
          </label>
          <label>
            Password
            <input
              required
              name="password"
              type="password"
              minLength={6}
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button className={styles.primary} disabled={busy}>
            {busy
              ? "Connecting..."
              : mode === "sign-in"
                ? "Sign in"
                : "Create profile"}
          </button>
        </form>
        <button
          className={styles.switch}
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        >
          {mode === "sign-in"
            ? "Need a profile? Register"
            : "Already registered? Sign in"}
        </button>
      </section>
    </main>
  );
}
