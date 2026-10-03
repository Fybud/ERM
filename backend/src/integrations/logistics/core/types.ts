/**
 * Logistics integration — core types.
 * Provider jargon (Easy Ship, FBA, etc.) must not appear here.
 */

export type LogisticsProviderId = string;

export type CredentialFieldType = "text" | "password" | "select";

export interface CredentialField {
  name: string;
  label: string;
  type: CredentialFieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface LogisticsCredentials {
  [key: string]: string | undefined;
}

export type LogisticsKind = "MARKETPLACE" | "EXTERNAL";

export interface CreateShipmentInput {
  /** ERM order id */
  orderId: string;
  channelOrderId?: string;
  /** Sales channel id (for compatibility checks) */
  salesChannelId: string;
  reference?: string;
  weightKg?: number;
  dimensionsCm?: { length: number; width: number; height: number };
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  metadata?: Record<string, unknown>;
  /** Raw order snapshot for adapters that need line items / marketplace */
  orderSnapshot?: Record<string, unknown>;
}

export interface ShipmentResult {
  id: string;
  provider: string;
  trackingNumber?: string;
  trackingUrl?: string;
  labelUrl?: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface ShippingLabel {
  shipmentId: string;
  trackingNumber?: string;
  format: "PDF" | "PNG" | "URL" | "DATA";
  url?: string;
  contentBase64?: string;
  metadata?: Record<string, unknown>;
}

export interface SchedulePickupInput {
  shipmentId: string;
  trackingNumber?: string;
  pickupDate?: string;
  pickupSlotId?: string;
  metadata?: Record<string, unknown>;
}

export interface PickupResult {
  pickupId: string;
  shipmentId: string;
  scheduledAt?: string;
  status: "SCHEDULED" | "PENDING" | "CANCELLED";
  metadata?: Record<string, unknown>;
}

export interface PickupSlotOption {
  id: string;
  label: string;
  startsAt: string;
  endsAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TrackingEvent {
  status: string;
  location?: string;
  occurredAt?: string;
  description?: string;
}

export interface TrackingInfo {
  trackingNumber: string;
  carrier: string;
  status: string;
  rawStatus?: string;
  estimatedDeliveryAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  events?: TrackingEvent[];
  metadata?: Record<string, unknown>;
}
