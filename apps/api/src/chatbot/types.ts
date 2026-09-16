export type ChatbotMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatbotSource = {
  id: string;
  title: string;
  score: number;
};

export type ChatbotReply = {
  reply: string;
  sources: ChatbotSource[];
  provider: "azure-foundry";
};

export class ChatbotUnavailableError extends Error {
  constructor(message = "The AI advisor is temporarily unavailable.") {
    super(message);
    this.name = "ChatbotUnavailableError";
  }
}
