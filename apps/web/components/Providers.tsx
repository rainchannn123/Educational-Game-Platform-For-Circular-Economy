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
    const timer = window.setInterval(() => void redirect(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
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
