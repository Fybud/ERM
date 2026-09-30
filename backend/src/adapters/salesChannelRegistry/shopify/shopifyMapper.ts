import { AdapterOrder, AdapterProduct, AdapterShipment } from "../SalesChannelAdapter.js";
import { ShipmentStatus } from "../../../models/domain.js";
import { ShopifyFulfillmentRaw, ShopifyOrderRaw, ShopifyProductRaw } from "./shopifyClient.js";
import { toCanonicalStatus } from "../../../services/orderLifecycle.js";

function mapOrderStatus(fulfillmentStatus: string | null): ReturnType<typeof toCanonicalStatus> {
  if (!fulfillmentStatus) return "READY_TO_PACK";
  const s = fulfillmentStatus.toLowerCase();
  if (s === "fulfilled") return "SHIPMENT_CREATED";
  if (s === "partial") return "PACKED";
  return toCanonicalStatus(fulfillmentStatus);
}

export function mapShopifyProduct(raw: ShopifyProductRaw): AdapterProduct {
  const variant = raw.variants[0];
  return {
    channelProductId: String(raw.id),
    sku: variant?.sku || String(raw.id),
    name: raw.title,
    price: Number(variant?.price || 0),
    quantity: variant?.inventory_quantity || 0,
  };
}

export function mapShopifyOrder(raw: ShopifyOrderRaw): AdapterOrder {
  return {
    channelOrderId: String(raw.id),
    status: mapOrderStatus(raw.fulfillment_status),
    currency: raw.currency || "INR",
    totalAmount: Number(raw.total_price || 0),
    customer: {
      name: [raw.customer?.first_name, raw.customer?.last_name].filter(Boolean).join(" ") || "Shopify Customer",
      email: raw.customer?.email,
      phone: raw.customer?.phone,
      address: raw.shipping_address?.address1,
    },
    items: raw.line_items.map((item) => ({
      channelOrderItemId: String(item.id),
      channelProductId: item.product_id ? String(item.product_id) : undefined,
      sku: item.sku || String(item.id),
      name: item.title,
      quantity: item.quantity,
      unitPrice: Number(item.price || 0),
    })),
    createdAt: raw.created_at,
  };
}

export function mapShopifyShipment(raw: ShopifyFulfillmentRaw): AdapterShipment {
  return {
    channelShipmentId: String(raw.id),
    channelOrderId: String(raw.order_id),
    status: (raw.status === "success" ? "IN_TRANSIT" : "PENDING") as ShipmentStatus,
    fulfillmentType: "SHOPIFY",
    carrier: raw.tracking_company || "Shopify Logistics",
    trackingNumber: raw.tracking_number,
  };
}
