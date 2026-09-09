"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, clearToken, getToken } from "../lib/api";
import styles from "./PlayerAccount.module.css";

type Player = {
  id: string;
  displayName: string;
  roles: string[];
};

const isLiveGameRoute = (pathname: string): boolean =>
  /^\/games\/[^/]+\/(municipality|mrf|broker)$/.test(pathname);

export function PlayerAccount() {
  const pathname = usePathname();
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);

  useEffect(() => {
    if (!getToken() || isLiveGameRoute(pathname)) {
      setPlayer(null);
      return;
    }

    let active = true;
    void api<Player | null>("/v1/me")
      .then((profile) => {
        if (active) {
          setPlayer(profile);
        }
      })
      .catch(() => {
        if (active) {
          setPlayer(null);
        }
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  if (!player || isLiveGameRoute(pathname)) {
    return null;
  }

  const roleLabel = player.roles.includes("admin")
    ? "Administrator"
    : player.roles.includes("facilitator")
      ? "Facilitator"
      : "Player";

  function logout() {
    clearToken();
    setPlayer(null);
    router.replace("/");
  }

  return (
    <aside className={styles.account} aria-label="Signed-in player">
      <div className={styles.identity}>
        <span className={styles.avatar} aria-hidden="true">
          {player.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span>
          <strong>{player.displayName}</strong>
          <small>{roleLabel}</small>
        </span>
      </div>
      <button type="button" onClick={logout}>
        Log out
      </button>
    </aside>
  );
}
