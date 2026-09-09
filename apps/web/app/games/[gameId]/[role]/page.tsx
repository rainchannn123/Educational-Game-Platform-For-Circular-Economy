import { GameScreen } from "../../../../components/GameScreen";
import type { Role } from "@circular-city/contracts";
export default async function RoleGamePage({
  params,
}: {
  params: Promise<{ gameId: string; role: Role }>;
}) {
  const { gameId, role } = await params;
  return <GameScreen gameId={gameId} routeRole={role} />;
}
