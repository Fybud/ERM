/**
 * Channel integration — core types (normalized + credential schema).
 * Core domain services must depend on these abstractions, never on provider SDKs.
 */

export type SalesChannelId = string;

export type CredentialFieldType = "text" | "password" | "select";

export interface CredentialField {
  name: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface ChannelCredentials {
  [key: string]: string | undefined;
}

export interface ProductQuery {
  sku?: string;
  cursor?: string;
  limit?: number;
}

export interface InventoryQuery {
  sku?: string;
  locationId?: string;
}

export interface OrderQuery {
  since?: Date;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface ChannelProduct {
  id: string;
  channelProductId: string;
  sku: string;
  name: string;
  description?: string;
  price: number;
  quantity: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelInventoryItem {
  sku: string;
  locationId?: string;
  available: number;
  reserved?: number;
  onHand?: number;
  metadata?: Record<string, unknown>;
}

export interface InventoryUpdate {
  sku: string;
  quantity: number;
  locationId?: string;
}

export interface ChannelCustomer {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface ChannelOrderItem {
  channelOrderItemId: string;
  channelProductId?: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

/** Normalized order as returned by channel adapters (not the ERM DB row). */
export interface ChannelOrder {
  channelOrderId: string;
  status: string;
  currency: string;
  totalAmount: number;
  customer?: ChannelCustomer;
  items: ChannelOrderItem[];
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateFulfillmentInput {
  channelOrderId: string;
  trackingNumber?: string;
  carrier?: string;
  items?: { sku: string; quantity: number }[];
  metadata?: Record<string, unknown>;
}

export interface UpdateFulfillmentInput {
  channelOrderId: string;
  channelFulfillmentId?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface TrackingUpdate {
  channelOrderId: string;
  trackingNumber: string;
  carrier?: string;
  orderStatus?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelFulfillment {
  channelFulfillmentId: string;
  channelOrderId: string;
  status: string;
  trackingNumber?: string;
  carrier?: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookHandleResult {
  accepted: boolean;
  eventType?: string;
  externalId?: string;
  note?: string;
}
