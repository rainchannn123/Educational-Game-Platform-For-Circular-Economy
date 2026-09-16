import type { ChatbotSource } from "./types.js";

type KnowledgeChunk = {
  id: string;
  title: string;
  text: string;
  keywords: string[];
};

const KNOWLEDGE: KnowledgeChunk[] = [
  {
    id: "material-flow",
    title: "Material Flow",
    keywords: ["waste", "municipality", "transport", "mrf", "decompose", "stream"],
    text: "Municipality transports raw mixed waste to the MRF. MRF must decompose an arrived batch before recycling individual material streams. A recycling method processes one compatible held stream at a time.",
  },
  {
    id: "mrf-recycling",
    title: "MRF Recycling And Landfill",
    keywords: ["recycle", "recycling", "landfill", "contamination", "grade", "recovered"],
    text: "Recycling costs more than landfill but produces recovered Grade A, B, or C material based on contamination. Recovered material is added to shared inventory and MRF inventory. Landfill costs less, produces no usable material, adds substantially more CO2, and applies a health penalty.",
  },
  {
    id: "inventory",
    title: "Shared And Role Inventory",
    keywords: ["inventory", "shared", "mrf", "broker", "transfer", "material", "stock"],
    text: "Shared inventory is the team-wide stock used for project requirements. Role inventory identifies which role holds transferable stock. MRF and Broker can transfer recovered material to teammates; Municipality transports raw waste but cannot dispatch recovered-material transfers.",
  },
  {
    id: "projects",
    title: "Projects And Rewards",
    keywords: ["project", "complete", "reward", "municipality", "co2", "multiplier"],
    text: "Only Municipality can complete a project. Project requirements are checked against shared inventory. The reward multiplier is calculated from the team’s CO2 performance relative to the other cities and ranges from 0.5x to 2.0x.",
  },
  {
    id: "broker",
    title: "Broker Role",
    keywords: ["broker", "purchase", "trade", "market", "price", "external"],
    text: "Broker can make external material purchases, manage trade offers, and transfer Broker-held material to MRF or Municipality. Active trades reserve material, so reserved stock cannot be transferred until it is released or settled.",
  },
  {
    id: "health",
    title: "City Health And Quizzes",
    keywords: ["health", "quiz", "question", "recovery", "wrong", "landfill"],
    text: "Role quizzes start 30 seconds after the game begins, repeat every minute, and remain open for 30 seconds. Wrong or missed responses can affect City Health. At zero health, the team is locked for 30 seconds before the worker restores health to 20.",
  },
  {
    id: "communication",
    title: "City Signal",
    keywords: ["chat", "team", "global", "signal", "message", "communication"],
    text: "City Signal includes announcements, private Team chat, Global chat, and the AI advisor. Team chat is visible only to teammates. Global chat is visible to all players in the same game.",
  },
];

const tokens = (value: string): string[] =>
  value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];

export function retrieveKnowledge(
  query: string,
  limit = 4,
): Array<{ text: string; source: ChatbotSource }> {
  const queryTokens = new Set(tokens(query));
  return KNOWLEDGE.map((chunk) => {
    const searchable = new Set([...tokens(chunk.text), ...chunk.keywords]);
    const score = [...queryTokens].reduce(
      (sum, token) => sum + (searchable.has(token) ? 1 : 0),
      0,
    );
    return { chunk, score };
  })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ chunk, score }) => ({
      text: chunk.text,
      source: { id: chunk.id, title: chunk.title, score },
    }));
}
