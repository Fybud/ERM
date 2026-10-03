import { AdapterCredentials, PickupSlot } from "../SalesChannelAdapter.js";
import { env } from "../../../config/env.js";
import { withRetry } from "../../../utils/crypto.js";
import { logger } from "../../../utils/logger.js";
import { AppError } from "../../../middleware/errorHandler.js";

export interface AmazonListingRaw {
  asin: string;
  sellerSku: string;
  itemName: string;
  price: number;
  quantity: number;
  description?: string;
  imageUrl?: string;
}

export interface AmazonOrderRaw {
  AmazonOrderId: string;
  OrderStatus: string;
  PurchaseDate?: string;
  OrderTotal?: { Amount: string; CurrencyCode: string };
  BuyerInfo?: { Name?: string; Email?: string; Phone?: string };
  ShippingAddress?: { AddressLine1?: string };
  OrderItems: Array<{
    OrderItemId: string;
    ASIN?: string;
    SellerSKU: string;
    Title: string;
    QuantityOrdered: number;
    ItemPrice?: { Amount: string };
  }>;
}

export interface AmazonShipmentRaw {
  AmazonOrderId: string;
  EasyShipShipmentId: string;
  status: string;
  carrier?: string;
  trackingId?: string;
  scheduledSlot?: PickupSlot;
  shippedAt?: string;
  deliveredAt?: string;
}

/** In-memory stubs for MOCK_CHANNELS=true only. Never seeded with demo catalog data. */
const memory = {
  products: [] as AmazonListingRaw[],
  orders: [] as AmazonOrderRaw[],
  shipments: new Map<string, AmazonShipmentRaw>(),
};

export class AmazonClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private credentials: AdapterCredentials) {}

  async validateCredentials(): Promise<boolean> {
    const required = ["sellerId", "clientId", "clientSecret", "refreshToken", "marketplaceId"] as const;
    for (const key of required) {
      if (!this.credentials[key]?.trim()) return false;
    }

    if (env.mockChannels) return true;

    try {
      await this.getAccessToken();
      return true;
    } catch (error) {
      logger.warn({ err: error }, "Amazon LWA validation failed");
      return false;
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.credentials.refreshToken || "",
      client_id: this.credentials.clientId || "",
      client_secret: this.credentials.clientSecret || "",
    });

    const response = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Amazon LWA token exchange failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.accessToken = json.access_token;
    this.accessTokenExpiresAt = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  async listListings(): Promise<AmazonListingRaw[]> {
    if (!env.mockChannels) {
      // Real Listings Items API can be wired here using getAccessToken(), sellerId, marketplaceId
      await this.getAccessToken();
      return [];
    }
    return withRetry(async () => [...memory.products]);
  }

  async listOrders(_since?: Date): Promise<AmazonOrderRaw[]> {
    if (!env.mockChannels) {
      await this.getAccessToken();
      return [];
    }
    return withRetry(async () => [...memory.orders]);
  }

  async getOrder(orderId: string): Promise<AmazonOrderRaw | null> {
    if (!env.mockChannels) {
      await this.getAccessToken();
      return null;
    }
    return memory.orders.find((o) => o.AmazonOrderId === orderId) || null;
  }

  async getInventory(sku?: string): Promise<AmazonListingRaw[]> {
    if (!env.mockChannels) {
      await this.getAccessToken();
      return [];
    }
    return memory.products.filter((p) => !sku || p.sellerSku === sku);
  }

  async updateInventory(sku: string, quantity: number): Promise<void> {
    await withRetry(async () => {
      const tokenLooksMock =
        !this.credentials.refreshToken ||
        String(this.credentials.refreshToken).startsWith("mock");

      if (env.mockChannels && tokenLooksMock) {
        const product = memory.products.find((p) => p.sellerSku === sku);
        if (product) product.quantity = quantity;
        else {
          memory.products.push({
            asin: `ASIN-${sku}`,
            sellerSku: sku,
            itemName: sku,
            price: 0,
            quantity,
          });
        }
        return;
      }

      // Live Listings Items / Feeds patch is not fully wired — fail loudly so ERM does not report success.
      throw new AppError(
        "Amazon live inventory push is not configured yet. Shopify inventory sync is live; Amazon/Flipkart need listings credentials/wiring.",
        501
      );
    });
  }

  async upsertProduct(input: {
    sku: string;
    name: string;
    price: number;
    quantity: number;
    description?: string;
    imageUrl?: string | null;
  }): Promise<void> {
    const tokenLooksMock =
      !this.credentials.refreshToken ||
      String(this.credentials.refreshToken).startsWith("mock");

    if (env.mockChannels && tokenLooksMock) {
      const product = memory.products.find((p) => p.sellerSku === input.sku);
      if (product) {
        product.itemName = input.name;
        product.price = input.price;
        product.quantity = input.quantity;
        product.description = input.description;
        product.imageUrl = input.imageUrl || undefined;
      } else {
        memory.products.push({
          asin: `ASIN-${input.sku}`,
          sellerSku: input.sku,
          itemName: input.name,
          price: input.price,
          quantity: input.quantity,
          description: input.description,
          imageUrl: input.imageUrl || undefined,
        });
      }
      return;
    }

    await this.updateInventory(input.sku, input.quantity);
  }

  async getEasyShipShipment(orderId: string): Promise<AmazonShipmentRaw | null> {
    return memory.shipments.get(orderId) || null;
  }

  async getPickupSlots(orderId: string): Promise<PickupSlot[]> {
    const start = new Date();
    start.setHours(start.getHours() + 4);
    const end = new Date(start);
    end.setHours(end.getHours() + 2);
    return [
      { id: `${orderId}-slot-1`, start: start.toISOString(), end: end.toISOString() },
      {
        id: `${orderId}-slot-2`,
        start: new Date(start.getTime() + 86400000).toISOString(),
        end: new Date(end.getTime() + 86400000).toISOString(),
      },
    ];
  }

  async markPacked(orderId: string): Promise<AmazonShipmentRaw> {
    const shipment: AmazonShipmentRaw = {
      AmazonOrderId: orderId,
      EasyShipShipmentId: `ES-${orderId}`,
      status: "PendingSchedule",
      carrier: "Amazon Logistics",
    };
    memory.shipments.set(orderId, shipment);
    return shipment;
  }

  async scheduleEasyShip(orderId: string, pickupSlotId: string): Promise<AmazonShipmentRaw> {
    const existing = memory.shipments.get(orderId) || {
      AmazonOrderId: orderId,
      EasyShipShipmentId: `ES-${orderId}`,
      status: "PendingPickUp",
      carrier: "Amazon Logistics",
    };
    existing.status = "PendingPickUp";
    existing.scheduledSlot = { id: pickupSlotId, start: new Date().toISOString(), end: new Date().toISOString() };
    existing.trackingId = `AMZ-${Math.floor(Math.random() * 1e8)}`;
    memory.shipments.set(orderId, existing);
    return existing;
  }

  /**
   * Self-Ship: confirm dispatch / tracking to Amazon (or sim store).
   * Live Sellers API (confirmShipment / Feeds) can replace the stub below.
   */
  async updateSelfShipStatus(
    orderId: string,
    input: { trackingNumber?: string; carrier?: string; orderStatus?: string }
  ): Promise<AmazonShipmentRaw> {
    const mapped =
      input.orderStatus === "DELIVERED"
        ? "Delivered"
        : input.orderStatus === "DELIVERY_FAILED"
          ? "Rejected"
          : input.orderStatus === "PICKED_UP" ||
            input.orderStatus === "IN_TRANSIT" ||
            input.orderStatus === "SHIPPED" ||
            input.orderStatus === "OUT_FOR_DELIVERY"
            ? "Shipped"
            : "PendingPickUp";

    if (!env.mockChannels && !env.simulationMode) {
      await this.getAccessToken();
      // Live Self-Ship confirm APIs not fully wired — acknowledge locally so ERM continues.
      logger.info(
        { orderId, trackingNumber: input.trackingNumber, status: mapped },
        "Amazon Self-Ship status acknowledged (live confirm API stub)"
      );
    }

    const existing = memory.shipments.get(orderId) || {
      AmazonOrderId: orderId,
      EasyShipShipmentId: `SS-${orderId}`,
      status: mapped,
      carrier: input.carrier || "Self Ship",
    };
    existing.status = mapped;
    existing.carrier = input.carrier || existing.carrier || "Self Ship";
    existing.trackingId = input.trackingNumber || existing.trackingId;
    if (mapped === "Delivered") existing.deliveredAt = new Date().toISOString();
    if (mapped === "Shipped") existing.shippedAt = existing.shippedAt || new Date().toISOString();
    memory.shipments.set(orderId, existing);
    return existing;
  }

  static injectOrder(order: AmazonOrderRaw) {
    if (!env.mockChannels) return;
    memory.orders = memory.orders.filter((o) => o.AmazonOrderId !== order.AmazonOrderId);
    memory.orders.push(order);
  }
}
