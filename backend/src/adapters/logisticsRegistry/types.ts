import { ChannelType, Order, ShipmentStatus } from "../../models/domain.js";

/**
 * Plug-and-play logistics service id.
 * Marketplace ids = ecommerce owns tracking.
 * External ids = merchant/3PL owns tracking.
 */
export type LogisticsServiceId =
  | "DELHIVERY"
  | "BLUEDART"
  | "SHIPROCKET"
  | "ECOM_EXPRESS"
  | "XPRESSBEES"
  | "DTDC"
  | "SHADOWFAX"
  | "EKART"
  | "AMAZON_SHIPPING"
  | "GATI"
  | "FEDEX"
  | "INDIA_POST"
  | "BLITZ"
  | "ITHINK_LOGISTICS"
  | "MANUAL_COURIER";

/** @deprecated use LogisticsServiceId */
export type LogisticsPartnerId = LogisticsServiceId;

export type LogisticsKind = "MARKETPLACE" | "EXTERNAL";

/** Every sales channel this ERM currently integrates. */
export const ALL_SALES_CHANNELS: ChannelType[] = ["AMAZON", "FLIPKART", "SHOPIFY"];

export interface LogisticsCredentialField {
  key: string;
  label: string;
  type?: "password" | "text";
}

export interface LogisticsCapabilities {
  createShipment: boolean;
  schedulePickup: boolean;
  generateLabel: boolean;
  tracking: boolean;
  cancelShipment: boolean;
}

export const DEFAULT_EXTERNAL_CAPABILITIES: LogisticsCapabilities = {
  createShipment: true,
  schedulePickup: true,
  generateLabel: true,
  tracking: true,
  cancelShipment: true,
};

export const MARKETPLACE_CAPABILITIES: LogisticsCapabilities = {
  createShipment: true,
  schedulePickup: true,
  generateLabel: true,
  tracking: true,
  cancelShipment: true,
};

export interface LogisticsServiceMeta {
  id: LogisticsServiceId;
  label: string;
  description: string;
  kind: LogisticsKind;
  /**
   * Sales channels this logistics provider can actually ship for.
   * Architecture allows any combination; this list drives Settings + validation.
   */
  supportedChannels: ChannelType[];
  marketplaceChannel?: ChannelType;
  requiredFields: LogisticsCredentialField[];
  capabilities: LogisticsCapabilities;
}

/** @deprecated use LogisticsServiceMeta */
export type LogisticsPartnerMeta = LogisticsServiceMeta;

export interface LogisticsCredentials {
  [key: string]: string | undefined;
}

export interface TrackingEvent {
  status: string;
  location?: string;
  occurredAt?: string;
  description?: string;
}

export interface TrackingResult {
  trackingNumber: string;
  carrier: string;
  status: ShipmentStatus;
  rawStatus?: string;
  estimatedDeliveryAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  events?: TrackingEvent[];
  metadata?: Record<string, unknown>;
}

export type TrackingInfo = TrackingResult;

export interface CreateShipmentInput {
  order: Order;
  reference?: string;
  weightKg?: number;
  dimensionsCm?: { length: number; width: number; height: number };
  metadata?: Record<string, unknown>;
}

export interface ShipmentResult {
  id: string;
  trackingNumber: string;
  carrier: string;
  status: ShipmentStatus;
  labelUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface SchedulePickupInput {
  shipmentId: string;
  trackingNumber?: string;
  pickupDate?: string;
  pickupSlotId?: string;
  metadata?: Record<string, unknown>;
}

export interface PickupSlotOption {
  id: string;
  label: string;
  startsAt: string;
  endsAt?: string;
  metadata?: Record<string, unknown>;
}

export interface PickupResult {
  pickupId: string;
  shipmentId: string;
  scheduledAt?: string;
  status: "SCHEDULED" | "PENDING" | "CANCELLED";
  metadata?: Record<string, unknown>;
}

export interface ShippingLabel {
  shipmentId: string;
  trackingNumber: string;
  format: "PDF" | "PNG" | "URL" | "DATA";
  url?: string;
  contentBase64?: string;
  metadata?: Record<string, unknown>;
}

export interface LogisticsAdapter {
  readonly id: LogisticsServiceId;
  readonly capabilities: LogisticsCapabilities;
  /** Whether this provider can fulfill shipments for the given sales channel. */
  supportsChannel(channel: ChannelType): boolean;
  connect(credentials: LogisticsCredentials): Promise<void>;
  validateCredentials(): Promise<boolean>;
  createShipment(input: CreateShipmentInput): Promise<ShipmentResult>;
  schedulePickup(input: SchedulePickupInput): Promise<PickupResult>;
  generateLabel(shipmentId: string): Promise<ShippingLabel>;
  /** Optional: providers that expose pickup windows (Amazon Easy Ship, etc.). Sim always returns options. */
  getPickupSlots?(shipmentId: string): Promise<PickupSlotOption[]>;
  getTracking(shipmentId: string): Promise<TrackingInfo | null>;
  cancelShipment(shipmentId: string): Promise<void>;
  track(trackingNumber: string): Promise<TrackingResult | null>;
  simulateAdvance?(trackingNumber: string, status: ShipmentStatus): Promise<TrackingResult>;
}

/** @deprecated use LogisticsAdapter */
export type LogisticsServiceAdapter = LogisticsAdapter;
/** @deprecated use LogisticsAdapter */
export type LogisticsPartnerAdapter = LogisticsAdapter;

export function defineExternalMeta(
  partial: Omit<LogisticsServiceMeta, "kind" | "capabilities" | "supportedChannels"> & {
    capabilities?: Partial<LogisticsCapabilities>;
    /** Defaults to all sales channels when omitted. */
    supportedChannels?: ChannelType[];
  }
): LogisticsServiceMeta {
  return {
    ...partial,
    kind: "EXTERNAL",
    supportedChannels:
      partial.supportedChannels && partial.supportedChannels.length > 0
        ? partial.supportedChannels
        : [...ALL_SALES_CHANNELS],
    capabilities: { ...DEFAULT_EXTERNAL_CAPABILITIES, ...(partial.capabilities || {}) },
  };
}

export function logisticsSupportsChannel(
  meta: Pick<LogisticsServiceMeta, "supportedChannels">,
  channel: ChannelType
): boolean {
  return meta.supportedChannels.includes(channel);
}

export function mapCourierStatus(raw: string): ShipmentStatus {
  const s = raw.toUpperCase();
  if (s.includes("RTO") || s.includes("UNDELIVER") || s.includes("FAILED")) return "RTO";
  if (s.includes("DELIVER")) return "DELIVERED";
  if (s.includes("OFD") || s.includes("OUT FOR") || s.includes("OUT_FOR")) return "IN_TRANSIT";
  if (
    s.includes("SHIP") ||
    s.includes("TRANSIT") ||
    s.includes("IN_TRANSIT") ||
    s.includes("DISPATCH")
  ) {
    return "IN_TRANSIT";
  }
  if (s.includes("PICK")) return "PICKED_UP";
  if (s.includes("READY") || s.includes("MANIFEST")) return "READY_FOR_PICKUP";
  if (s.includes("LABEL") || s.includes("BOOK") || s.includes("CREATED")) return "LABEL_CREATED";
  if (s.includes("CANCEL")) return "CANCELLED";
  return "PENDING";
}
