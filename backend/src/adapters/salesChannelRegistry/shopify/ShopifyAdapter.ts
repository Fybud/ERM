import {
  AdapterCredentials,
  AdapterOrder,
  AdapterProduct,
  AdapterShipment,
  ChannelAdapter,
  CreateTestOrderInput,
  CreateTestOrderResult,
  FulfillOrderInput,
  InventoryUpdateInput,
  ProductSyncInput,
} from "../SalesChannelAdapter.js";
import { ShopifyClient } from "./shopifyClient.js";
import { mapShopifyOrder, mapShopifyProduct, mapShopifyShipment } from "./shopifyMapper.js";
import { AppError } from "../../../middleware/errorHandler.js";
import { env } from "../../../config/env.js";
import {
  exchangeShopifyClientCredentials,
  normalizeShopifyShopDomain,
  shopifyAccessTokenIsFresh,
} from "./shopifyAuth.js";
import { SHOPIFY_SIM_CUSTOMER } from "../../logisticsRegistry/fulfillment/fulfillmentTypes.js";
import { SHOPIFY_FULFILLMENT_METHODS } from "../fulfillmentMethods.js";
import type { FulfillmentMethodDefinition } from "../fulfillmentMethods.js";

export class ShopifyAdapter implements ChannelAdapter {
  readonly channel = "SHOPIFY" as const;
  private client: ShopifyClient | null = null;

  constructor(private credentials: AdapterCredentials = {}) {
    if (Object.keys(credentials).length) this.client = new ShopifyClient(credentials);
  }

  getFulfillmentMethods(): FulfillmentMethodDefinition[] {
    return SHOPIFY_FULFILLMENT_METHODS;
  }

  private requireClient() {
    if (!this.client) throw new AppError("Shopify adapter is not connected", 400);
    return this.client;
  }

  /**
   * Obtains / refreshes Admin API access token via Client Credentials Grant
   * and mutates `credentials` in place so the caller can persist it.
   *
   * MOCK_CHANNELS only stubs tokens when no real app credentials are present.
   * Inventory / catalog sync requires a live access token whenever Client ID+Secret exist.
   */
  async ensureAccessToken(credentials: AdapterCredentials): Promise<void> {
    credentials.shopDomain = normalizeShopifyShopDomain(String(credentials.shopDomain || ""));

    const hasAppCredentials = Boolean(
      credentials.shopDomain && credentials.clientId && credentials.clientSecret
    );

    if (env.mockChannels && !hasAppCredentials) {
      credentials.accessToken = credentials.accessToken || "mock-shopify-token";
      credentials.accessTokenExpiresAt =
        credentials.accessTokenExpiresAt || new Date(Date.now() + 86400_000).toISOString();
      return;
    }

    if (shopifyAccessTokenIsFresh(credentials)) return;

    if (!credentials.clientId || !credentials.clientSecret) {
      throw new AppError("Shopify Client ID and Client secret are required", 400);
    }

    const token = await exchangeShopifyClientCredentials({
      shopDomain: String(credentials.shopDomain),
      clientId: String(credentials.clientId),
      clientSecret: String(credentials.clientSecret),
    });

    credentials.accessToken = token.accessToken;
    credentials.accessTokenExpiresAt = token.expiresAt;
    if (token.scope) credentials.scope = token.scope;

    const granted = new Set(
      String(token.scope || "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    if (granted.size > 0) {
      const hasInventory = granted.has("write_inventory");
      // Shopify write_* typically implies read_* for the same resource; either is enough.
      const hasLocations = granted.has("read_locations") || granted.has("write_locations");
      const missing: string[] = [];
      if (!hasInventory) missing.push("write_inventory");
      if (!hasLocations) missing.push("read_locations (or write_locations)");
      if (missing.length) {
        throw new AppError(
          `Shopify token is missing scopes: ${missing.join(", ")}. ` +
            `In Dev Dashboard → ERP → active version, enable ` +
            `read_products, write_products, read_inventory, write_inventory, read_locations, ` +
            `write_fulfillments, write_merchant_managed_fulfillment_orders, ` +
            `then uninstall + reinstall the app on the shop and Connect again.`,
          403
        );
      }
    }
  }

  private assertFulfillmentScopes() {
    const granted = new Set(
      String(this.credentials.scope || "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    if (!granted.size) return;
    const missing: string[] = [];
    if (!granted.has("write_fulfillments")) missing.push("write_fulfillments");
    if (
      !granted.has("write_merchant_managed_fulfillment_orders") &&
      !granted.has("read_merchant_managed_fulfillment_orders")
    ) {
      missing.push("write_merchant_managed_fulfillment_orders");
    }
    if (missing.length) {
      throw new AppError(
        `Shopify cannot update order fulfillment. Enable Admin API scopes ` +
          `${missing.join(", ")} on the custom app, then Disconnect and Connect again ` +
          `so a new token is issued. Current token scopes: ${[...granted].join(", ")}`,
        403
      );
    }
  }

  async connect(credentials: AdapterCredentials): Promise<void> {
    await this.ensureAccessToken(credentials);
    this.credentials = credentials;
    this.client = new ShopifyClient(credentials);
    if (!(await this.client.validateCredentials())) {
      throw new AppError("Invalid Shopify credentials or shop access", 401);
    }
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.credentials = {};
  }

  async getStatus() {
    if (!this.client) return { connected: false };
    try {
      await this.ensureAccessToken(this.credentials);
      this.client = new ShopifyClient(this.credentials);
      const ok = await this.client.validateCredentials();
      return { connected: ok, details: ok ? "Shopify Admin API ready" : "Auth failed" };
    } catch (error) {
      return {
        connected: false,
        details: error instanceof Error ? error.message : "Auth failed",
      };
    }
  }

  async getProducts(): Promise<AdapterProduct[]> {
    return (await this.requireClient().listProducts()).map(mapShopifyProduct);
  }

  async getOrders(since?: Date): Promise<AdapterOrder[]> {
    return (await this.requireClient().listOrders(since)).map(mapShopifyOrder);
  }

  async getOrder(channelOrderId: string): Promise<AdapterOrder | null> {
    const order = await this.requireClient().getOrder(channelOrderId);
    return order ? mapShopifyOrder(order) : null;
  }

  async getInventory(sku?: string): Promise<AdapterProduct[]> {
    return (await this.requireClient().getInventory(sku)).map(mapShopifyProduct);
  }

  async updateInventory(input: InventoryUpdateInput): Promise<void> {
    await this.requireClient().updateInventory(input.sku, input.quantity);
  }

  async upsertProduct(input: ProductSyncInput): Promise<void> {
    await this.requireClient().upsertProduct(input);
  }

  async getShipment(channelOrderId: string): Promise<AdapterShipment | null> {
    const shipment = await this.requireClient().getFulfillment(channelOrderId);
    return shipment ? mapShopifyShipment(shipment) : null;
  }

  async fulfillOrder(input: FulfillOrderInput): Promise<AdapterShipment> {
    this.assertFulfillmentScopes();
    if (input.action === "UPDATE_SHIPMENT") {
      const shipment = await this.requireClient().createFulfillment(input.channelOrderId, {
        trackingNumber: input.trackingNumber,
        carrier: input.carrier,
      });
      return mapShopifyShipment(shipment);
    }
    if (input.action !== "CREATE_FULFILLMENT" && input.action !== "PACK") {
      throw new AppError(`Unsupported Shopify fulfill action: ${input.action}`, 400);
    }
    const shipment = await this.requireClient().createFulfillment(input.channelOrderId, {
      trackingNumber: input.trackingNumber,
      carrier: input.carrier,
    });
    return mapShopifyShipment(shipment);
  }

  async createTestOrder(input: CreateTestOrderInput): Promise<CreateTestOrderResult> {
    const client = this.requireClient();
    const customer = {
      name: SHOPIFY_SIM_CUSTOMER.name,
      email: SHOPIFY_SIM_CUSTOMER.email,
      phone: SHOPIFY_SIM_CUSTOMER.phone,
      address: SHOPIFY_SIM_CUSTOMER.address,
    };
    const existing = await client.findCustomerByEmail(customer.email);

    const lineItems = [];
    for (const item of input.items) {
      const variant = await client.findVariantBySku(item.sku);
      if (variant) {
        lineItems.push({ variant_id: variant.variantId, quantity: item.quantity });
      } else {
        lineItems.push({
          title: item.name,
          quantity: item.quantity,
          price: String(item.unitPrice),
          sku: item.sku,
        });
      }
    }

    const raw = await client.createOrder({
      customerId: existing?.id,
      customer,
      lineItems,
    });

    return {
      createdOnChannel: true,
      order: mapShopifyOrder(raw),
      note: existing
        ? `Created Shopify order ${raw.name || raw.id} for ${customer.name}`
        : `Created Shopify order ${raw.name || raw.id} for ${customer.name} (guest checkout)`,
    };
  }
}
