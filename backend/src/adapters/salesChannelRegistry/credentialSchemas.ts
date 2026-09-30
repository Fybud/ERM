import { z } from "zod";
import { ChannelType } from "../../models/domain.js";
import { AppError } from "../../middleware/errorHandler.js";
import { normalizeShopifyShopDomain } from "./shopify/shopifyAuth.js";

/** Amazon India marketplace ID — fixed for this product */
export const AMAZON_INDIA_MARKETPLACE_ID = "A21TJRUUN4KGV";

const amazonCredentials = z.object({
  sellerId: z.string({ required_error: "Seller ID is required" }).min(1, "Seller ID is required"),
  clientId: z
    .string({ required_error: "Client identifier is required" })
    .min(1, "Client identifier is required"),
  clientSecret: z
    .string({ required_error: "Client secret is required" })
    .min(1, "Client secret is required"),
  refreshToken: z
    .string({ required_error: "Refresh token is required" })
    .min(1, "Refresh token is required"),
  marketplaceId: z.string().optional(),
});

const flipkartCredentials = z.object({
  clientId: z.string({ required_error: "Client ID is required" }).min(1, "Client ID is required"),
  clientSecret: z
    .string({ required_error: "Client secret is required" })
    .min(1, "Client secret is required"),
  accessToken: z
    .string({ required_error: "Access token is required" })
    .min(1, "Access token is required"),
});

const shopifyCredentials = z.object({
  shopDomain: z
    .string({ required_error: "Shop domain is required" })
    .min(1, "Shop domain is required"),
  clientId: z.string({ required_error: "Client ID is required" }).min(1, "Client ID is required"),
  clientSecret: z
    .string({ required_error: "Client secret is required" })
    .min(1, "Client secret is required"),
  // Populated automatically via Client Credentials Grant — not collected in the UI
  accessToken: z.string().optional(),
  accessTokenExpiresAt: z.string().optional(),
  scope: z.string().optional(),
});

const schemas: Record<ChannelType, z.ZodTypeAny> = {
  AMAZON: amazonCredentials,
  FLIPKART: flipkartCredentials,
  SHOPIFY: shopifyCredentials,
};

export function parseChannelCredentials(channel: ChannelType, raw: Record<string, string>) {
  const schema = schemas[channel];
  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join("; ");
    throw new AppError(message || "Invalid credentials", 400);
  }

  const credentials = { ...(result.data as Record<string, string>) };
  if (channel === "AMAZON") {
    credentials.marketplaceId = AMAZON_INDIA_MARKETPLACE_ID;
  }
  if (channel === "SHOPIFY") {
    credentials.shopDomain = normalizeShopifyShopDomain(credentials.shopDomain);
  }
  return credentials;
}

/** Fields shown in the connect modal (no hidden/defaulted values) */
export const CHANNEL_CREDENTIAL_META: Record<
  ChannelType,
  { key: string; label: string; type?: "password" | "text" }[]
> = {
  AMAZON: [
    { key: "sellerId", label: "Seller ID" },
    { key: "clientId", label: "Client identifier" },
    { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "refreshToken", label: "Refresh token", type: "password" },
  ],
  FLIPKART: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "accessToken", label: "Access token", type: "password" },
  ],
  SHOPIFY: [
    { key: "shopDomain", label: "Shop (e.g. fybud)" },
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client secret", type: "password" },
  ],
};
