const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_SOCKET_URL ??
  "http://localhost:4000";
const authChangedEvent = "circular-city-auth-changed";
const notifyAuthChanged = (): void => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(authChangedEvent));
};
export const getToken = (): string | null =>
  typeof window === "undefined"
    ? null
    : sessionStorage.getItem("circular-city-token");
export const setToken = (token: string): void => {
  sessionStorage.setItem("circular-city-token", token);
  notifyAuthChanged();
};
export const clearToken = (): void => {
  sessionStorage.removeItem("circular-city-token");
  notifyAuthChanged();
};
export { authChangedEvent };
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new Error(
      `Game API returned ${response.status} for ${path}. Check the API deployment URL.`,
    );
  const json = (await response.json()) as {
    success: boolean;
    data?: T;
    error?: { message: string; code: string };
  };
  if (!response.ok || !json.success)
    throw Object.assign(new Error(json.error?.message ?? "Request failed"), {
      code: json.error?.code,
    });
  return json.data as T;
}
export async function command<T>(path: string, body: unknown): Promise<T> {
  const id = crypto.randomUUID();
  return api<T>(path, {
    method: "POST",
    headers: { "idempotency-key": id },
    body: JSON.stringify({ ...(body as object), commandId: id }),
  });
}
