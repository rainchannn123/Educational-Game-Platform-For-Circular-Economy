import type { Metadata } from "next";
import "../styles/tokens.css";
import "../styles/globals.css";
import "../styles/animations.css";
import "../styles/utilities.css";
import { PlayerAccount } from "../components/PlayerAccount";
import { Providers } from "../components/Providers";
export const metadata: Metadata = {
  title: "Clash of the Cities",
  description: "A real-time circular economy learning game",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <PlayerAccount />
          {children}
        </Providers>
      </body>
    </html>
  );
}
