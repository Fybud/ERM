import { z } from "zod";
import { orderRepository } from "../repositories/order.repository.js";
import { OrderStatus } from "../models/domain.js";
import { AppError } from "../middleware/errorHandler.js";
import { AdapterOrder } from "../adapters/salesChannelRegistry/SalesChannelAdapter.js";
import { customerRepository } from "../repositories/customer.repository.js";
import { productRepository } from "../repositories/product.repository.js";
import { ChannelType } from "../models/domain.js";
import { publishEvent } from "../events/eventBus.js";
import {
  assertValidTransition,
  furtherStatus,
  inferStatusFromTimestamps,
  isMerchantTransition,
  StatusSource,
  timestampsForStatus,
  toCanonicalStatus,
} from "./orderLifecycle.js";
import { fulfillmentService } from "./FulfillmentService.js";
import { shipmentRepository } from "../repositories/shipment.repository.js";

function toFrontendOrder(
  order: NonNullable<Awaited<ReturnType<typeof orderRepository.findById>>>,
  shipment?: Awaited<ReturnType<typeof shipmentRepository.findByOrderId>>[number] | null
) {
  const meta = shipment?.metadata || {};
  const labelUrl =
    typeof meta.labelUrl === "string" && meta.labelUrl.trim() ? String(meta.labelUrl) : undefined;
  let status = inferStatusFromTimestamps(order.status, order);
  if (shipment?.trackingNumber || shipment?.carrier) {
    status = furtherStatus(status, "SHIPMENT_CREATED");
  }
  return {
    id: order.id,
    marketplace: order.marketplace,
    status,
    lastStatusSource: order.lastStatusSource || undefined,
    createdAt: order.createdAt,
    packedAt: order.packedAt || undefined,
    shippedAt: order.shippedAt || undefined,
    deliveredAt: order.deliveredAt || undefined,
    trackingNumber: shipment?.trackingNumber || undefined,
    carrier: shipment?.carrier || undefined,
    labelUrl,
    items: order.items.map((item) => ({
      skuId: item.channelSku,
      skuName: item.skuName || item.channelSku,
      quantity: item.quantity,
    })),
  };
}

const updateSchema = z.object({
  status: z.string(),
  packedAt: z.string().optional().nullable(),
  shippedAt: z.string().optional().nullable(),
  deliveredAt: z.string().optional().nullable(),
});

export class OrderService {
  private async attachShipment(
    order: NonNullable<Awaited<ReturnType<typeof orderRepository.findById>>>
  ) {
    const shipments = await shipmentRepository.findByOrderId(order.id);
    return toFrontendOrder(order, shipments[0] || null);
  }

  async list() {
    const orders = await orderRepository.list();
    const shipments = await shipmentRepository.findLatestByOrderIds(orders.map((o) => o.id));
    const views = [];
    for (const o of orders) {
      const shipment = shipments.get(o.id) || null;
      const view = toFrontendOrder(o, shipment);
      if (view.status !== o.status) {
        await orderRepository.updateStatus(o.id, view.status, {}, "SYSTEM");
      }
      views.push(view);
    }
    return views;
  }

  async applyStatusChange(
    id: string,
    targetStatus: OrderStatus,
    source: StatusSource,
    options: {
      timestamps?: Partial<{ packedAt: string; shippedAt: string; deliveredAt: string }>;
      skipTransitionCheck?: boolean;
      triggerFulfillment?: boolean;
    } = {}
  ) {
    const existing = await orderRepository.findById(id);
    if (!existing) throw new AppError("Order not found", 404);

    const from = existing.status;
    const to = toCanonicalStatus(targetStatus);

    if (!options.skipTransitionCheck) {
      assertValidTransition(from, to);
    }

    const stamps = {
      ...timestampsForStatus(to),
      ...options.timestamps,
    };

    // Shopify fulfill must succeed before ERP shows Packed; otherwise the board lies.
    if (options.triggerFulfillment && to === "PACKED") {
      await this.maybeFulfillOnChannel(existing, to);
    }

    const updated = await orderRepository.updateStatus(id, to, stamps, source);
    if (!updated) throw new AppError("Order not found", 404);

    if (options.triggerFulfillment && to !== "PACKED") {
      await this.maybeFulfillOnChannel(existing, to);
    }

    const refreshed = await orderRepository.findById(id);
    const view = await this.attachShipment(refreshed || updated);
    await publishEvent({
      type: "order.status_changed",
      payload: {
        orderId: view.id,
        marketplace: String(view.marketplace),
        previousStatus: from,
        status: view.status,
        source,
        channelOrderId: existing.channelOrderId,
      },
    });

    return view;
  }

  async getPickupSlots(orderId: string) {
    return fulfillmentService.getPickupSlots(orderId);
  }

  async schedulePickup(orderId: string, body: unknown) {
    const schema = z.object({
      pickupSlotId: z.string().optional(),
      pickupDate: z.string().optional(),
    });
    const input = schema.parse(body || {});
    const result = await fulfillmentService.schedulePickup(orderId, input);
    if (!result.order) throw new AppError("Order not found", 404);
    const view = await this.attachShipment(result.order);
    await publishEvent({
      type: "order.status_changed",
      payload: {
        orderId: view.id,
        marketplace: String(view.marketplace),
        previousStatus: "SHIPMENT_CREATED",
        status: view.status,
        source: "MERCHANT",
        channelOrderId: result.order.channelOrderId,
      },
    });
    return view;
  }

  async createManual(body: unknown) {
    const schema = z.object({
      id: z.string().optional(),
      marketplace: z.string(),
      status: z.string().default("READY_TO_PACK"),
      createdAt: z.string().optional(),
      packedAt: z.string().optional(),
      shippedAt: z.string().optional(),
      deliveredAt: z.string().optional(),
      items: z.array(
        z.object({
          skuId: z.string(),
          skuName: z.string(),
          quantity: z.number().int().positive(),
        })
      ),
    });

    const input = schema.parse(body);
    const status = toCanonicalStatus(input.status);
    const created = await orderRepository.createManual({
      id: input.id,
      marketplace: input.marketplace,
      status,
      channelOrderId: input.id || `SIM-${Date.now()}`,
      createdAt: input.createdAt,
      packedAt: input.packedAt,
      shippedAt: input.shippedAt,
      deliveredAt: input.deliveredAt,
      items: input.items,
    });
    await orderRepository.updateStatus(created.id, status, {}, "SYSTEM");
    const createdFull = await orderRepository.findById(created.id);
    if (!createdFull) throw new AppError("Order not found", 404);
    const view = await this.attachShipment(createdFull);
    await publishEvent({
      type: "order.created",
      payload: {
        orderId: view.id,
        marketplace: view.marketplace,
        status: view.status,
        source: "SYSTEM",
      },
    });
    return view;
  }

  async update(id: string, body: unknown) {
    const input = updateSchema.parse(body);
    const target = toCanonicalStatus(input.status);
    const existing = await orderRepository.findById(id);
    if (!existing) throw new AppError("Order not found", 404);

    if (!isMerchantTransition(existing.status, target)) {
      throw new AppError(
        `Orders board cannot move ${existing.status} → ${target}. Mark Packed first, then Create shipment / Pickup.`,
        400
      );
    }

    return this.applyStatusChange(id, target, "MERCHANT", {
      timestamps: {
        packedAt: input.packedAt || undefined,
        shippedAt: input.shippedAt || undefined,
        deliveredAt: input.deliveredAt || undefined,
      },
      skipTransitionCheck: true,
      triggerFulfillment: true,
    });
  }

  private async maybeFulfillOnChannel(
    existing: NonNullable<Awaited<ReturnType<typeof orderRepository.findById>>>,
    status: OrderStatus
  ) {
    // Label / shipment are created when moving Packed → Shipment, not on Pack.
    if (status === "SHIPMENT_CREATED") {
      try {
        await fulfillmentService.prepareShipment(existing);
      } catch (error) {
        // Surface failures so merchant knows label creation failed.
        throw error instanceof Error
          ? error
          : new AppError("Failed to create shipment / label", 502);
      }
      return;
    }
    if (status === "PACKED") {
      await fulfillmentService.onPacked(existing);
    }
  }

  async ingestAdapterOrder(channelConfigId: string, marketplace: ChannelType, order: AdapterOrder) {
    let customerId: string | null = null;
    if (order.customer) {
      customerId = await customerRepository.findOrCreate({
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
        address: order.customer.address,
      });
    }

    const items = [];
    for (const item of order.items) {
      const product = await productRepository.findBySku(item.sku);
      items.push({
        channelOrderItemId: item.channelOrderItemId,
        channelProductId: item.channelProductId,
        channelSku: item.sku,
        skuName: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        productId: product?.id || null,
      });
    }

    const status = toCanonicalStatus(order.status);
    const saved = await orderRepository.upsertNormalizedOrder({
      channelConfigId,
      channelOrderId: order.channelOrderId,
      marketplace,
      status,
      totalAmount: order.totalAmount,
      currency: order.currency,
      customerId,
      createdAt: order.createdAt,
      items,
    });

    const stamps = timestampsForStatus(status);
    const inferred = inferStatusFromTimestamps(saved.status, {
      packedAt: stamps.packedAt || saved.packedAt,
      shippedAt: stamps.shippedAt || saved.shippedAt,
      deliveredAt: stamps.deliveredAt || saved.deliveredAt,
    });
    const fillStamps =
      saved.status === status
        ? {
            packedAt: saved.packedAt ? undefined : stamps.packedAt,
            shippedAt: saved.shippedAt ? undefined : stamps.shippedAt,
            deliveredAt: saved.deliveredAt ? undefined : stamps.deliveredAt,
          }
        : {};
    if (inferred !== saved.status || fillStamps.packedAt || fillStamps.shippedAt || fillStamps.deliveredAt) {
      await orderRepository.updateStatus(saved.id, inferred, fillStamps, marketplace);
    }

    const refreshed = (await orderRepository.findById(saved.id))!;

    await publishEvent({
      type: "order.ingested",
      payload: {
        orderId: refreshed.id,
        marketplace: refreshed.marketplace,
        status: refreshed.status,
        channelOrderId: order.channelOrderId,
        source: marketplace,
      },
    });

    await publishEvent({
      type: "order.status_changed",
      payload: {
        orderId: refreshed.id,
        marketplace: String(refreshed.marketplace),
        previousStatus: saved.status,
        status: refreshed.status,
        source: marketplace,
        channelOrderId: order.channelOrderId,
      },
    });

    return refreshed;
  }
}

export const orderService = new OrderService();
