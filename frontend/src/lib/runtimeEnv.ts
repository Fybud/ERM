type EnvMap = Record<string, string | undefined>;

declare global {
  interface Window {
    __ENV__?: EnvMap;
  }
}

/**
 * Runtime config for the built SPA.
 *
 * Priority:
 *  1. `window.__ENV__` — written at container start from Deploy-injected `VITE_*`
 *  2. `import.meta.env` — Vite build values (local dev)
 */
export function env(key: string): string | undefined {
  const injected = typeof window !== "undefined" ? window.__ENV__?.[key] : undefined;
  if (injected !== undefined && injected !== "") return injected;
  const fromBuild = (import.meta as unknown as { env: EnvMap }).env;
  return fromBuild?.[key];
}

export function envOr(key: string, fallback = ""): string {
  return env(key) ?? fallback;
}

export function apiBaseUrl(): string {
  return envOr("VITE_API_BASE_URL").replace(/\/$/, "");
}
