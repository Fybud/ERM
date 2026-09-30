import { AdapterCredentials } from "../SalesChannelAdapter.js";
import { env } from "../../../config/env.js";
import { withRetry } from "../../../utils/crypto.js";
import { AppError } from "../../../middleware/errorHandler.js";

export interface ShopifyProductRaw {
  id: number;
  title: string;
  body_html?: string;
  variants: Array<{
    id: number;
    sku: string;
    price: string;
    inventory_quantity: number;
    inventory_item_id?: number;
    inventory_management?: string | null;
  }>;
  images?: Array<{ src?: string }>;
}

export interface ShopifyOrderRaw {
  id: number;
  name: string;
  financial_status?: string;
  fulfillment_status: string | null;
  created_at?: string;
  currency: string;
  total_price: string;
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string };
  shipping_address?: { address1?: string };
  line_items: Array<{
    id: number;
    sku: string;
    title: string;
    quantity: number;
    price: string;
    product_id?: number;
    variant_id?: number;
  }>;
}

export interface ShopifyFulfillmentRaw {
  id: number;
  order_id: number;
  status: string;
  tracking_number?: string;
  tracking_company?: string;
}

export interface ShopifyCustomerRaw {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

/** In-memory stubs for MOCK_CHANNELS=true only. */
const memory = {
  products: [] as ShopifyProductRaw[],
  orders: [] as ShopifyOrderRaw[],
  customers: [] as ShopifyCustomerRaw[],
  fulfillments: new Map<number, ShopifyFulfillmentRaw>(),
};

function toShopifyImageSrc(imageUrl?: string | null): string | undefined {
  if (!imageUrl?.trim()) return undefined;
  let url = imageUrl.trim();
  if (url.startsWith("data:")) return undefined;
  if (url.startsWith("/")) {
    if (!env.publicApiUrl) return undefined;
    url = `${env.publicApiUrl}${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return undefined;
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export class ShopifyClient {
  constructor(private credentials: AdapterCredentials) {}

  /**
   * MOCK_CHANNELS stubs order creation / demo catalog only.
   * Inventory + product upsert always use the live Admin API when a real token exists.
   */
  private useMockCatalog(): boolean {
    if (!env.mockChannels) return false;
    const token = String(this.credentials.accessToken || "");
    return !token || token === "mock-shopify-token";
  }

  private shopDomain() {
    return (this.credentials.shopDomain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  private headers() {
    return {
      "X-Shopify-Access-Token": this.credentials.accessToken || "",
      "Content-Type": "application/json",
    };
  }


  private apiUrl(path: string) {
    return `https://${this.shopDomain()}/admin/api/2024-10${path}`;
  }

  private async shopifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.apiUrl(path), {
      ...init,
      headers: {
        ...this.headers(),
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (!response.ok) {
      const rawErrors = json?.errors;
      let message =
        typeof rawErrors === "string"
          ? rawErrors
          : rawErrors
            ? JSON.stringify(rawErrors)
            : `Shopify API ${response.status}`;

      if (response.status === 403) {
        message = this.forbiddenMessage(path, message);
      }

      throw new AppError(message, response.status >= 400 && response.status < 500 ? response.status : 502);
    }
    return json as T;
  }

  private forbiddenMessage(path: string, fallback: string): string {
    const scopeHint = this.inventoryScopeHint();
    if (path.includes("inventory_levels") || path.includes("/variants/")) {
      return (
        `Shopify inventory write denied (403). Enable Admin API scopes ` +
        `read_products, write_products, read_inventory, write_inventory, read_locations ` +
        `on the custom app, then Disconnect and Connect again so a new token is issued.` +
        (scopeHint ? ` Current token scopes: ${scopeHint}` : "")
      );
    }
    if (path.includes("fulfillment")) {
      return (
        `Shopify fulfillment denied (403). Enable Admin API scopes ` +
        `write_fulfillments, write_merchant_managed_fulfillment_orders ` +
        `on the custom app, then Disconnect and Connect again so a new token is issued.` +
        (scopeHint ? ` Current token scopes: ${scopeHint}` : "")
      );
    }
    if (fallback && fallback !== "Shopify API 403") return fallback;
    return (
      `Shopify API access denied (403). Check the custom app scopes and reinstall/reconnect.` +
      (scopeHint ? ` Current token scopes: ${scopeHint}` : "")
    );
  }

  private inventoryScopeHint(): string | null {
    const scope = String(this.credentials.scope || "").trim();
    return scope || null;
  }

  async validateCredentials(): Promise<boolean> {
    if (!(this.credentials.shopDomain && this.credentials.accessToken)) return false;
    if (this.useMockCatalog()) return true;

    try {
      await this.shopifyFetch<{ shop: unknown }>("/shop.json");
      return true;
    } catch {
      return false;
    }
  }

  async listProducts(): Promise<ShopifyProductRaw[]> {
    if (this.useMockCatalog()) return withRetry(async () => [...memory.products]);

    const json = await this.shopifyFetch<{ products: ShopifyProductRaw[] }>("/products.json?limit=250");
    return json.products || [];
  }

  async findVariantBySku(sku: string): Promise<{
    productId: number;
    variantId: number;
    price: string;
    title: string;
    inventoryItemId?: number;
  } | null> {
    const products = await this.listProducts();
    for (const product of products) {
      const variant = product.variants.find((v) => v.sku === sku);
      if (variant) {
        return {
          productId: product.id,
          variantId: variant.id,
          price: variant.price,
          title: product.title,
          inventoryItemId: variant.inventory_item_id,
        };
      }
    }
    return null;
  }

  async listOrders(_since?: Date): Promise<ShopifyOrderRaw[]> {
    if (env.mockChannels) return withRetry(async () => [...memory.orders]);

    const json = await this.shopifyFetch<{ orders: ShopifyOrderRaw[] }>("/orders.json?status=any&limit=100");
    return json.orders || [];
  }

  async getOrder(orderId: string): Promise<ShopifyOrderRaw | null> {
    if (env.mockChannels) {
      return memory.orders.find((o) => String(o.id) === orderId) || null;
    }
    try {
      const json = await this.shopifyFetch<{ order: ShopifyOrderRaw }>(`/orders/${orderId}.json`);
      return json.order || null;
    } catch {
      return null;
    }
  }

  async getInventory(sku?: string) {
    const products = await this.listProducts();
    return products
      .map((p) => ({
        ...p,
        variants: p.variants.filter((v) => !sku || v.sku === sku),
      }))
      .filter((p) => p.variants.length > 0);
  }

  async updateInventory(sku: string, quantity: number) {
    // Inventory always targets the live shop when credentials are real (even if MOCK_CHANNELS=true).
    if (this.useMockCatalog()) {
      await withRetry(async () => {
        for (const product of memory.products) {
          const variant = product.variants.find((v) => v.sku === sku);
          if (variant) {
            variant.inventory_quantity = quantity;
            return;
          }
        }
        memory.products.push({
          id: Date.now(),
          title: sku,
          variants: [{ id: Date.now() + 1, sku, price: "0", inventory_quantity: quantity }],
        });
      });
      return;
    }

    const found = await this.findVariantBySku(sku);
    if (!found) {
      throw new AppError(`Shopify product with SKU ${sku} not found`, 404);
    }

    let inventoryItemId = found.inventoryItemId;
    if (!inventoryItemId) {
      const variantJson = await this.shopifyFetch<{
        variant: { inventory_item_id: number };
      }>(`/variants/${found.variantId}.json`);
      inventoryItemId = variantJson.variant.inventory_item_id;
    }

    await this.shopifyFetch(`/variants/${found.variantId}.json`, {
      method: "PUT",
      body: JSON.stringify({
        variant: {
          id: found.variantId,
          inventory_management: "shopify",
        },
      }),
    });

    const locations = await this.shopifyFetch<{ locations: Array<{ id: number; active?: boolean }> }>(
      "/locations.json"
    );
    const location = locations.locations?.find((l) => l.active !== false) || locations.locations?.[0];
    if (!location) {
      throw new AppError("No Shopify location available for inventory update", 502);
    }

    // Activate the item at the location before absolute set (Shopify requires this).
    try {
      await this.shopifyFetch("/inventory_levels/connect.json", {
        method: "POST",
        body: JSON.stringify({
          location_id: location.id,
          inventory_item_id: inventoryItemId,
        }),
      });
    } catch (error) {
      // Already connected / already stocked is fine — continue to set.
      const msg = error instanceof Error ? error.message : "";
      if (!/already|taken|exists|422|inventory item is already/i.test(msg)) {
        // Permission errors should surface; soft-skip only benign connect duplicates.
        if (error instanceof AppError && error.status === 403) throw error;
      }
    }

    await this.shopifyFetch("/inventory_levels/set.json", {
      method: "POST",
      body: JSON.stringify({
        location_id: location.id,
        inventory_item_id: inventoryItemId,
        available: quantity,
      }),
    });
  }

  async upsertProduct(input: {
    sku: string;
    name: string;
    price: number;
    quantity: number;
    description?: string;
    imageUrl?: string | null;
  }) {
    if (this.useMockCatalog()) {
      await withRetry(async () => {
        for (const product of memory.products) {
          const variant = product.variants.find((v) => v.sku === input.sku);
          if (variant) {
            product.title = input.name;
            product.body_html = input.description || "";
            variant.price = String(input.price);
            variant.inventory_quantity = input.quantity;
            if (input.imageUrl) product.images = [{ src: input.imageUrl }];
            return;
          }
        }
        memory.products.push({
          id: Date.now(),
          title: input.name,
          body_html: input.description || "",
          images: input.imageUrl ? [{ src: input.imageUrl }] : undefined,
          variants: [
            {
              id: Date.now() + 1,
              sku: input.sku,
              price: String(input.price),
              inventory_quantity: input.quantity,
              inventory_management: "shopify",
            },
          ],
        });
      });
      return;
    }

    const found = await this.findVariantBySku(input.sku);
    const imageSrc = toShopifyImageSrc(input.imageUrl);
    const productBody = (includeImage: boolean) => ({
      title: input.name,
      body_html: input.description || "",
      variants: found
        ? [
            {
              id: found.variantId,
              price: String(input.price),
              sku: input.sku,
              inventory_management: "shopify",
            },
          ]
        : [
            {
              price: String(input.price),
              sku: input.sku,
              inventory_management: "shopify",
              inventory_quantity: input.quantity,
            },
          ],
      ...(includeImage && imageSrc ? { images: [{ src: imageSrc }] } : {}),
    });

    const send = async (includeImage: boolean) => {
      if (found) {
        await this.shopifyFetch(`/products/${found.productId}.json`, {
          method: "PUT",
          body: JSON.stringify({
            product: { id: found.productId, ...productBody(includeImage) },
          }),
        });
        return;
      }
      await this.shopifyFetch("/products.json", {
        method: "POST",
        body: JSON.stringify({ product: productBody(includeImage) }),
      });
    };

    try {
      await send(Boolean(imageSrc));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (imageSrc && /image url is invalid/i.test(message)) {
        await send(false);
      } else {
        throw error;
      }
    }

    await this.updateInventory(input.sku, input.quantity);
  }

  async findCustomerByEmail(email: string): Promise<ShopifyCustomerRaw | null> {
    if (!email) return null;

    if (env.mockChannels) {
      return memory.customers.find((c) => c.email === email) || null;
    }

    try {
      const search = await this.shopifyFetch<{ customers: ShopifyCustomerRaw[] }>(
        `/customers/search.json?query=email:${encodeURIComponent(email)}`
      );
      return search.customers?.[0] || null;
    } catch {
      return null;
    }
  }

  async createOrder(input: {
    customerId?: number;
    customer: { name: string; email?: string; phone?: string; address?: string };
    lineItems: Array<
      | { variant_id: number; quantity: number }
      | { title: string; quantity: number; price: string; sku: string }
    >;
  }): Promise<ShopifyOrderRaw> {
    const [firstName, ...rest] = input.customer.name.trim().split(/\s+/);
    const lastName = rest.join(" ") || "Customer";
    const email = input.customer.email?.trim() || `erm+${Date.now()}@example.com`;
    const phone = input.customer.phone?.trim() || undefined;

    if (env.mockChannels) {
      const order: ShopifyOrderRaw = {
        id: Date.now(),
        name: `#SIM${memory.orders.length + 1001}`,
        financial_status: "paid",
        fulfillment_status: null,
        created_at: new Date().toISOString(),
        currency: "INR",
        total_price: "0",
        customer: {
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
        },
        shipping_address: { address1: input.customer.address },
        line_items: input.lineItems.map((li, idx) => {
          if ("variant_id" in li) {
            return {
              id: Date.now() + idx,
              sku: "",
              title: "Item",
              quantity: li.quantity,
              price: "0",
              variant_id: li.variant_id,
            };
          }
          return {
            id: Date.now() + idx,
            sku: li.sku,
            title: li.title,
            quantity: li.quantity,
            price: li.price,
          };
        }),
      };
      memory.orders.push(order);
      return order;
    }

    const address = input.customer.address
      ? {
          first_name: firstName,
          last_name: lastName,
          address1: input.customer.address,
          phone,
          country: "IN",
          city: "City",
          province: "State",
          zip: "000000",
        }
      : undefined;

    // Prefer attaching an existing customer. Do NOT create customers here —
    // that requires write_customers + merchant approval. Guest checkout fields
    // (email/phone/shipping) only need write_orders.
    const orderPayload: Record<string, unknown> = {
      email,
      phone,
      line_items: input.lineItems,
      financial_status: "paid",
      send_receipt: false,
      send_fulfillment_receipt: false,
      inventory_behaviour: "decrement_obeying_policy",
      shipping_address: address,
      billing_address: address,
    };

    if (input.customerId) {
      orderPayload.customer = { id: input.customerId };
    }

    const json = await this.shopifyFetch<{ order: ShopifyOrderRaw }>("/orders.json", {
      method: "POST",
      body: JSON.stringify({ order: orderPayload }),
    });
    return json.order;
  }

  async getFulfillment(orderId: string) {
    if (this.useMockCatalog()) {
      return memory.fulfillments.get(Number(orderId)) || null;
    }
    try {
      const json = await this.shopifyFetch<{ fulfillments: ShopifyFulfillmentRaw[] }>(
        `/orders/${orderId}/fulfillments.json`
      );
      const list = json.fulfillments || [];
      return list[list.length - 1] || null;
    } catch {
      return memory.fulfillments.get(Number(orderId)) || null;
    }
  }

  async createFulfillment(
    orderId: string,
    opts: { trackingNumber?: string; carrier?: string }
  ): Promise<ShopifyFulfillmentRaw> {
    if (this.useMockCatalog()) {
      const fulfillment: ShopifyFulfillmentRaw = {
        id: Date.now(),
        order_id: Number(orderId),
        status: "success",
        tracking_number: opts.trackingNumber || `SHP-${Math.floor(Math.random() * 1e8)}`,
        tracking_company: opts.carrier || "Merchant Logistics",
      };
      memory.fulfillments.set(Number(orderId), fulfillment);
      return fulfillment;
    }

    const existing = await this.getFulfillment(orderId);
    if (existing && opts.trackingNumber) {
      try {
        const updated = await this.shopifyFetch<{ fulfillment: ShopifyFulfillmentRaw }>(
          `/fulfillments/${existing.id}/update_tracking.json`,
          {
            method: "POST",
            body: JSON.stringify({
              fulfillment: {
                notify_customer: false,
                tracking_info: {
                  number: opts.trackingNumber,
                  company: opts.carrier || "Other",
                },
              },
            }),
          }
        );
        if (updated.fulfillment) return updated.fulfillment;
      } catch {
        // Fall through and try create
      }
    }

    let open: Array<{ id: number; status: string }> = [];
    try {
      const fos = await this.shopifyFetch<{
        fulfillment_orders: Array<{ id: number; status: string }>;
      }>(`/orders/${orderId}/fulfillment_orders.json`);

      const held = (fos.fulfillment_orders || []).filter(
        (fo) => String(fo.status) === "on_hold"
      );
      for (const fo of held) {
        try {
          await this.shopifyFetch(`/fulfillment_orders/${fo.id}/release_hold.json`, {
            method: "POST",
          });
        } catch {
          // Hold may require merchant action in Shopify Admin.
        }
      }

      const refreshed =
        held.length > 0
          ? await this.shopifyFetch<{
              fulfillment_orders: Array<{ id: number; status: string }>;
            }>(`/orders/${orderId}/fulfillment_orders.json`)
          : fos;

      open = (refreshed.fulfillment_orders || []).filter((fo) =>
        ["open", "in_progress", "scheduled"].includes(String(fo.status))
      );
    } catch (error) {
      const legacy = await this.createLegacyFulfillment(orderId, opts);
      if (legacy) return legacy;
      throw error;
    }

    if (!open.length) {
      if (existing) return existing;
      const legacy = await this.createLegacyFulfillment(orderId, opts);
      if (legacy) return legacy;
      throw new AppError(
        "Shopify order has no open fulfillment orders (already fulfilled, or missing write_fulfillments / write_merchant_managed_fulfillment_orders scopes). Enable those scopes on the custom app, then Disconnect and Connect again.",
        409
      );
    }

    const fulfillmentPayload: Record<string, unknown> = {
      notify_customer: false,
      line_items_by_fulfillment_order: open.map((fo) => ({
        fulfillment_order_id: fo.id,
      })),
    };
    if (opts.trackingNumber) {
      fulfillmentPayload.tracking_info = {
        number: opts.trackingNumber,
        company: opts.carrier || "Other",
      };
    }

    try {
      const json = await this.shopifyFetch<{ fulfillment: ShopifyFulfillmentRaw }>(
        "/fulfillments.json",
        {
          method: "POST",
          body: JSON.stringify({ fulfillment: fulfillmentPayload }),
        }
      );
      if (!json.fulfillment) {
        throw new AppError("Shopify did not return a fulfillment", 502);
      }
      return json.fulfillment;
    } catch (error) {
      const legacy = await this.createLegacyFulfillment(orderId, opts);
      if (legacy) return legacy;
      throw error;
    }
  }

  private async createLegacyFulfillment(
    orderId: string,
    opts: { trackingNumber?: string; carrier?: string }
  ): Promise<ShopifyFulfillmentRaw | null> {
    try {
      const json = await this.shopifyFetch<{ fulfillment: ShopifyFulfillmentRaw }>(
        `/orders/${orderId}/fulfillments.json`,
        {
          method: "POST",
          body: JSON.stringify({
            fulfillment: {
              notify_customer: false,
              tracking_number: opts.trackingNumber,
              tracking_company: opts.carrier || "Other",
            },
          }),
        }
      );
      return json.fulfillment || null;
    } catch {
      return null;
    }
  }

  static injectOrder(order: ShopifyOrderRaw) {
    if (!env.mockChannels) return;
    memory.orders = memory.orders.filter((o) => o.id !== order.id);
    memory.orders.push(order);
  }
}
