"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken } from "../lib/api";

type ActiveGame = { gameId: string; role: string } | null;
const isLiveGameRoute = (pathname: string): boolean =>
  /^\/games\/[^/]+\/(municipality|mrf|broker)$/.test(pathname);

function ActiveGameRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!getToken() || isLiveGameRoute(pathname)) return;
    let active = true;
    const redirect = async () => {
      try {
        const game = await api<ActiveGame>("/v1/me/active-game");
        if (active && game)
          router.replace(`/games/${game.gameId}/${game.role}`);
      } catch {
        // The current page remains usable if a background match lookup fails.
      }
    };
    void redirect();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void redirect();
    };
    const timer = window.setInterval(refreshWhenVisible, 15_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [pathname, router]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ActiveGameRedirect />
      {children}
    </QueryClientProvider>
  );
}
