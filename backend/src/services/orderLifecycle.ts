import { OrderStatus } from "../models/domain.js";
import { AppError } from "../middleware/errorHandler.js";

/** Who produced the status change — real adapter or internal simulator. */
export type StatusSource = "AMAZON" | "FLIPKART" | "SHOPIFY" | "SIMULATOR" | "MERCHANT" | "SYSTEM";

export const CANONICAL_STATUSES: OrderStatus[] = [
  "NEW",
  "CONFIRMED",
  "READY_TO_PACK",
  "PACKED",
  "SHIPMENT_CREATED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "RETURN_REQUESTED",
  "RETURNED",
  "DELIVERY_FAILED",
];

/** Happy-path forward edges used by merchant board + logistics simulation. */
const FORWARD: Partial<Record<OrderStatus, OrderStatus[]>> = {
  NEW: ["CONFIRMED", "READY_TO_PACK", "CANCELLED"],
  CONFIRMED: ["READY_TO_PACK", "CANCELLED"],
  READY_TO_PACK: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPMENT_CREATED", "PICKUP_SCHEDULED", "CANCELLED"],
  SHIPMENT_CREATED: ["PICKUP_SCHEDULED", "CANCELLED"],
  PICKUP_SCHEDULED: ["PICKED_UP", "IN_TRANSIT", "CANCELLED", "DELIVERY_FAILED"],
  PICKED_UP: ["IN_TRANSIT", "DELIVERY_FAILED", "CANCELLED"],
  IN_TRANSIT: ["OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "DELIVERY_FAILED"],
  DELIVERED: ["RETURN_REQUESTED"],
  RETURN_REQUESTED: ["RETURNED"],
};

/** Simulation UI actions offered from a given status. */
export interface SimulationAction {
  targetStatus: OrderStatus;
  label: string;
}

/**
 * Logistics board path (as of now):
 * Pick Up → In Transit → Delivered | RTO
 */
export function getSimulationActions(status: OrderStatus): SimulationAction[] {
  switch (status) {
    case "PACKED":
      return [{ targetStatus: "SHIPMENT_CREATED", label: "Create shipment" }];
    case "SHIPMENT_CREATED":
      return [{ targetStatus: "PICKUP_SCHEDULED", label: "Schedule pickup" }];
    case "PICKUP_SCHEDULED":
    case "PICKED_UP":
      // Pick Up lands on In Transit (skip lingering on PICKED_UP in the board UI).
      return [{ targetStatus: "IN_TRANSIT", label: "Pick Up" }];
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
      return [
        { targetStatus: "DELIVERED", label: "Delivered" },
        { targetStatus: "DELIVERY_FAILED", label: "RTO" },
      ];
    default:
      return [];
  }
}

/** Merchant kanban transitions on the Orders board. */
export function isMerchantTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (to === "PACKED" && ["NEW", "CONFIRMED", "READY_TO_PACK"].includes(from)) return true;
  // Packed → create shipment / label, then schedule pickup in UI.
  if (to === "SHIPMENT_CREATED" && from === "PACKED") return true;
  return false;
}

export function assertValidTransition(from: OrderStatus, to: OrderStatus) {
  if (from === to) {
    throw new AppError(`Order is already ${to}`, 400);
  }
  const allowed = FORWARD[from] || [];
  if (!allowed.includes(to)) {
    throw new AppError(`Invalid transition ${from} → ${to}`, 400);
  }
}

export function statusRank(status: OrderStatus): number {
  const i = CANONICAL_STATUSES.indexOf(status);
  return i < 0 ? 0 : i;
}

export function furtherStatus(a: OrderStatus, b: OrderStatus): OrderStatus {
  return statusRank(a) >= statusRank(b) ? a : b;
}

/**
 * packedAt / shippedAt survive channel syncs that rewind `status`.
 * Prefer the furthest of stored status vs timestamps so the kanban matches the card timeline.
 */
export function inferStatusFromTimestamps(
  status: OrderStatus,
  timestamps: {
    packedAt?: string | null;
    shippedAt?: string | null;
    deliveredAt?: string | null;
  }
): OrderStatus {
  if (status === "CANCELLED") return status;
  let next = status;
  if (timestamps.packedAt) next = furtherStatus(next, "PACKED");
  if (timestamps.shippedAt) next = furtherStatus(next, "IN_TRANSIT");
  if (timestamps.deliveredAt) {
    if (status === "DELIVERY_FAILED" || status === "RETURNED" || status === "RETURN_REQUESTED") {
      return status;
    }
    next = furtherStatus(next, "DELIVERED");
  }
  return next;
}

export function timestampsForStatus(status: OrderStatus): Partial<{
  packedAt: string;
  shippedAt: string;
  deliveredAt: string;
}> {
  const now = new Date().toISOString();
  if (
    status === "PACKED" ||
    status === "SHIPMENT_CREATED" ||
    status === "PICKUP_SCHEDULED"
  ) {
    return { packedAt: now };
  }
  if (status === "PICKED_UP" || status === "IN_TRANSIT" || status === "OUT_FOR_DELIVERY") {
    return { shippedAt: now };
  }
  if (status === "DELIVERED" || status === "DELIVERY_FAILED" || status === "RETURNED") {
    return { deliveredAt: now };
  }
  return {};
}

/** Map legacy / marketplace raw strings into the canonical model. */
export function toCanonicalStatus(raw: string | null | undefined): OrderStatus {
  if (!raw) return "READY_TO_PACK";
  const s = raw.toUpperCase().replace(/[\s-]+/g, "_");

  if ((CANONICAL_STATUSES as string[]).includes(s)) return s as OrderStatus;

  // Renamed / legacy ERM statuses
  if (s === "PROCESSING" || s === "AWAITING_PACKAGING") return "READY_TO_PACK";
  if (s === "FULFILLED") return "SHIPMENT_CREATED";
  if (s === "PARTIAL" || s === "PARTIALY_FULFILLED" || s === "PARTIALLY_FULFILLED") return "PACKED";
  if (s === "UNFULFILLED" || s === "NULL") return "READY_TO_PACK";
  if (s === "READY_FOR_LOGISTICS") return "PICKUP_SCHEDULED";
  if (s === "SHIPPED") return "IN_TRANSIT";
  if (s === "RTO" || s === "FAILED_DELIVERY") return "DELIVERY_FAILED";

  if (s.includes("CANCEL")) return "CANCELLED";
  if (s.includes("RETURN") && s.includes("REQUEST")) return "RETURN_REQUESTED";
  if (s.includes("RETURN")) return "RETURNED";
  if (s.includes("FAIL") || s.includes("UNDELIVER")) return "DELIVERY_FAILED";
  if (s.includes("DELIVER")) return "DELIVERED";
  if (s.includes("OUT_FOR") || s.includes("OFD")) return "OUT_FOR_DELIVERY";
  if (s.includes("PICKUP_SCHEDULE") || s.includes("PICKUP_SCHED")) return "PICKUP_SCHEDULED";
  if (s.includes("SHIPMENT_CREATED") || s === "SHIPMENT_CREATE") return "SHIPMENT_CREATED";
  if (s.includes("PICKUP_COMPLETE") || s.includes("PICKED")) return "PICKED_UP";
  if (s.includes("SHIP") || s.includes("TRANSIT") || s.includes("DISPATCH")) return "IN_TRANSIT";
  if (s.includes("READY") || s.includes("RTD") || s.includes("APPROVED")) return "PICKUP_SCHEDULED";
  if (s.includes("PACK")) return "PACKED";
  if (s.includes("CONFIRM") || s.includes("UNHOLD")) return "CONFIRMED";
  if (s.includes("HOLD") || s.includes("PENDING") || s.includes("NEW")) return "NEW";
  return "READY_TO_PACK";
}

export function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

/** Orders eligible for the Logistics Simulation board. */
export function isLogisticsEligible(status: OrderStatus) {
  return [
    "PACKED",
    "SHIPMENT_CREATED",
    "PICKUP_SCHEDULED",
    "PICKED_UP",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "RETURN_REQUESTED",
    "RETURNED",
    "DELIVERY_FAILED",
  ].includes(status);
}
