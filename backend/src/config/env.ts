import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://oms:oms_secret@localhost:5432/oms",
  adminPassword: process.env.ADMIN_PASSWORD || "12345",
  encryptionKey:
    process.env.ENCRYPTION_KEY || "dev-encryption-key-change-me-32b",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  /** Public origin Shopify/Flipkart can fetch, e.g. https://api.erm-demo.fybud.com */
  publicApiUrl: (process.env.PUBLIC_API_URL || "").replace(/\/$/, ""),
  /** Opt-in empty channel stubs (no seeded catalog). Default false for production. */
  mockChannels: (process.env.MOCK_CHANNELS || "false").toLowerCase() === "true",
  syncCron: process.env.SYNC_CRON || "*/5 * * * *",
  logLevel: process.env.LOG_LEVEL || "info",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  /** Enables Logistics Simulation UI/API (dev/admin). Default true in non-production. */
  simulationMode:
    (process.env.SIMULATION_MODE || (process.env.NODE_ENV === "production" ? "false" : "true")).toLowerCase() ===
    "true",
};
