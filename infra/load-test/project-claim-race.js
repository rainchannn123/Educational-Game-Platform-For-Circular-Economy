import http from "k6/http";
import { check } from "k6";
export const options = { vus: 30, iterations: 30 };
export default function () { const response = http.post(`${__ENV.API_URL}/v1/games/${__ENV.GAME_ID}/projects/${__ENV.PROJECT_ID}/claim`, JSON.stringify({ commandId: crypto.randomUUID(), expectedTeamRevision: Number(__ENV.TEAM_REVISION), payload: { confirm: true } }), { headers: { Authorization: `Bearer ${__ENV.TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() } }); check(response, { "claim settled or safely rejected": (result) => [200, 400, 409].includes(result.status) }); }
