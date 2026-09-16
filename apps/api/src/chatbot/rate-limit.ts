const windows = new Map<string, number[]>();

export function allowChatbotRequest(
  key: string,
  limit: number,
  windowMs: number,
  current = Date.now(),
): boolean {
  const recent = (windows.get(key) ?? []).filter(
    (timestamp) => timestamp > current - windowMs,
  );
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(current);
  windows.set(key, recent);
  return true;
}

export function clearChatbotRateLimits(): void {
  windows.clear();
}
