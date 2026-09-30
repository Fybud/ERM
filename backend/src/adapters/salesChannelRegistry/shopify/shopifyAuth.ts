import { AppError } from "../../../middleware/errorHandler.js";

export function normalizeShopifyShopDomain(input: string): string {
  let shop = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!shop) throw new AppError("Shop domain is required", 400);

  // Accept "fybud" → "fybud.myshopify.com"
  if (!shop.includes(".")) {
    shop = `${shop}.myshopify.com`;
  }

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new AppError("Enter a valid Shopify shop (e.g. fybud or fybud.myshopify.com)", 400);
  }

  return shop;
}

export interface ShopifyTokenResponse {
  accessToken: string;
  scope?: string;
  expiresIn: number;
  expiresAt: string;
}

/**
 * Client Credentials Grant for custom apps in the same organization.
 * POST https://{shop}.myshopify.com/admin/oauth/access_token
 */
export async function exchangeShopifyClientCredentials(input: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
}): Promise<ShopifyTokenResponse> {
  const shop = normalizeShopifyShopDomain(input.shopDomain);
  const url = `https://${shop}/admin/oauth/access_token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }

  if (!response.ok) {
    let message =
      (typeof json.error_description === "string" && json.error_description) ||
      (typeof json.error === "string" && json.error) ||
      (typeof json.errors === "string" && json.errors) ||
      "";

    if (!message && text.includes("app_not_installed")) {
      message =
        "Shopify app is not installed on this shop. Open the custom app in Shopify Admin and install it on the store, then try Connect again.";
    } else if (!message && /Oauth error/i.test(text)) {
      const match = text.match(/Oauth error[^<:]*/i);
      message = match?.[0]?.trim() || "Shopify OAuth error";
    } else if (!message) {
      message = `Shopify token exchange failed (${response.status})`;
    }

    throw new AppError(message, response.status >= 400 && response.status < 500 ? response.status : 502);
  }

  const accessToken = String(json.access_token || "");
  if (!accessToken) {
    throw new AppError("Shopify did not return an access token", 502);
  }

  const expiresIn = Number(json.expires_in || 86400);
  return {
    accessToken,
    scope: typeof json.scope === "string" ? json.scope : undefined,
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export function shopifyAccessTokenIsFresh(credentials: {
  accessToken?: string;
  accessTokenExpiresAt?: string;
}): boolean {
  if (!credentials.accessToken) return false;
  if (!credentials.accessTokenExpiresAt) {
    // Legacy static Admin token (no expiry stored) — treat as valid until API rejects.
    return true;
  }
  const expiresAt = Date.parse(credentials.accessTokenExpiresAt);
  if (Number.isNaN(expiresAt)) return false;
  // Refresh 2 minutes before expiry
  return Date.now() < expiresAt - 120_000;
}
