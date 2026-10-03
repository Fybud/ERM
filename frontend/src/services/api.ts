import { apiBaseUrl } from "@/lib/runtimeEnv";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof (body as { message?: string }).message === "string"
        ? (body as { message: string }).message
        : `Request failed: ${response.status}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}
