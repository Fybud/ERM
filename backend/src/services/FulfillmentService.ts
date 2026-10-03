import { Order, OrderStatus, ChannelType } from "../models/domain.js";
import { channelRepository } from "../repositories/channel.repository.js";
import { shipmentRepository } from "../repositories/shipment.repository.js";
import { orderRepository } from "../repositories/order.repository.js";
import { channelManager } from "./ChannelManager.js";
import {
  decryptLogisticsCredentials,
  defaultLogisticsProvider,
  logisticsRegistry,
  notifyMarketplaceSelfShip,
} from "../adapters/logisticsRegistry/index.js";
import {
  defaultFulfillmentMethodId,
  getFulfillmentMethod,
  type FulfillmentMethodDefinition,
} from "../adapters/salesChannelRegistry/fulfillmentMethods.js";
import { AppError } from "../middleware/errorHandler.js";
import { logger } from "../utils/logger.js";
import { timestampsForStatus } from "./orderLifecycle.js";
import { customerRepository } from "../repositories/customer.repository.js";
import { writeSimLabelPdf } from "../adapters/logisticsRegistry/base/simLabel.js";

/**
 * Channel → Fulfillment Method → Optional Logistics Provider
 *
 * Pack = ERM status only (Packed column).
 * Shipment / Pickup = create label + shipment, then merchant schedules pickup.
 */
export class FulfillmentService {
  /**
   * Called when merchant marks Packed. Does not create labels or advance past PACKED.
   * Channel-side pack signals (Easy Ship / NFBF) run when preparing shipment.
   */
  async onPacked(order: Order): Promise<OrderStatus | null> {
    if (String(order.marketplace).toUpperCase() !== "SHOPIFY" || !order.channelOrderId) {
      return null;
    }
    const channelAdapter = await channelManager.getAdapter("SHOPIFY");
    if (!channelAdapter) {
      throw new AppError(
        "Shopify is not connected. Connect Shopify in Settings, then mark the order packed again.",
        400
      );
    }
    await channelAdapter.fulfillOrder({
      channelOrderId: order.channelOrderId,
      action: "PACK",
    });
    return null;
  }

  /**
   * Packed → Shipment / Pickup: create shipment + shipping label.
   * Leaves order at SHIPMENT_CREATED so the UI can open the schedule-pickup modal.
   */
  async prepareShipment(order: Order): Promise<OrderStatus | null> {
    if (
      !order.marketplace ||
      !["AMAZON", "FLIPKART", "SHOPIFY"].includes(String(order.marketplace)) ||
      !order.channelConfigId
    ) {
      return null;
    }

    const channel = order.marketplace as ChannelType;
    const config = await channelRepository.findById(order.channelConfigId);
    if (!config?.enabled || config.status !== "CONNECTED") {
      return null;
    }

    const method = this.resolveMethod(channel, config.fulfillmentMethod);

    try {
      if (!method.requiresLogisticsProvider) {
        return await this.runChannelNativeFlow(order, channel, method);
      }
      const providerId = config.logisticsProvider || defaultLogisticsProvider(channel);
      return await this.runExternalLogisticsFlow(order, providerId, config, method);
    } catch (error) {
      logger.warn(
        { orderId: order.id, err: error, method: method.id },
        "Shipment / label preparation failed"
      );
      throw error;
    }
  }

  private resolveMethod(
    channel: ChannelType,
    fulfillmentMethod: string | null | undefined
  ): FulfillmentMethodDefinition {
    return (
      getFulfillmentMethod(channel, fulfillmentMethod) ||
      getFulfillmentMethod(channel, defaultFulfillmentMethodId(channel))!
    );
  }

  /** FBA / Easy Ship / FBF / NFBF — sales-channel fulfillment, no external LogisticsAdapter. */
  private async runChannelNativeFlow(
    order: Order,
    channel: ChannelType,
    method: FulfillmentMethodDefinition
  ): Promise<OrderStatus | null> {
    const channelAdapter = await channelManager.getAdapter(channel);
    if (!channelAdapter) {
      throw new AppError(`Sales channel adapter unavailable for ${channel}`, 500);
    }

    const fullOrder = (await orderRepository.findById(order.id)) || order;
    const customer = fullOrder.customerId
      ? await customerRepository.findById(fullOrder.customerId)
      : null;

    const result = await channelAdapter.fulfillOrder({
      channelOrderId: order.channelOrderId,
      action: "PACK",
      metadata: { fulfillmentMethod: method.id },
    });

    const carrier =
      result.carrier || method.defaultLogisticsProvider || method.id;
    const trackingNumber =
      result.trackingNumber ||
      `${method.id}-${order.channelOrderId}`.replace(/[^A-Za-z0-9-]/g, "").slice(0, 32);

    let labelUrl: string | null =
      typeof result.metadata?.labelUrl === "string" ? String(result.metadata.labelUrl) : null;
    if (!labelUrl && method.capabilities?.labelGeneration !== false) {
      const written = writeSimLabelPdf({
        carrier: String(carrier),
        awb: trackingNumber,
        orderId: order.channelOrderId,
        marketplace: channel,
        customerName: customer?.name || undefined,
      });
      labelUrl = written.relativeUrl;
    }

    const awaitsPickup = Boolean(method.capabilities?.pickupScheduling);

    await shipmentRepository.upsertForOrder({
      orderId: order.id,
      channelShipmentId: result.channelShipmentId || `${method.id}-${order.id.slice(0, 8)}`,
      status: labelUrl ? "LABEL_CREATED" : result.status || "PENDING",
      fulfillmentType: method.id,
      carrier: String(carrier),
      trackingNumber,
      metadata: {
        ...(result.metadata || {}),
        source: "CHANNEL_NATIVE",
        fulfillmentMethod: method.id,
        defaultLogisticsProvider: method.defaultLogisticsProvider || null,
        customerName: customer?.name || null,
        labelUrl,
        labelFormat: labelUrl ? "PDF" : null,
        labelContentType: labelUrl ? "application/pdf" : null,
        awaitingPickupSchedule: awaitsPickup,
      },
    });
    await this.setOrderStatus(order.id, "SHIPMENT_CREATED");
    return "SHIPMENT_CREATED";
  }

  /** Self Ship / Third-party — external courier via LogisticsAdapter. */
  private async runExternalLogisticsFlow(
    order: Order,
    providerId: string,
    config: Awaited<ReturnType<typeof channelRepository.findById>>,
    method: FulfillmentMethodDefinition
  ): Promise<OrderStatus | null> {
    if (!logisticsRegistry.has(providerId)) {
      throw new AppError(
        `Logistics provider ${providerId} is required for ${method.name} but is not available`,
        400
      );
    }
    const adapter = logisticsRegistry.get(providerId);
    const channel = order.marketplace as ChannelType;
    if (!adapter.supportsChannel(channel)) {
      throw new AppError(
        `Logistics provider ${providerId} does not support sales channel ${channel}`,
        400
      );
    }
    const credentials = decryptLogisticsCredentials(config?.logisticsCredentialsEncrypted) || {};
    await adapter.connect(credentials);

    const fullOrder = (await orderRepository.findById(order.id)) || order;
    const customer = fullOrder.customerId
      ? await customerRepository.findById(fullOrder.customerId)
      : null;

    const shipment = await adapter.createShipment({
      order: fullOrder,
      metadata: {
        customerName: customer?.name,
        customerPhone: customer?.phone,
        customerAddress: customer?.address,
        fulfillmentMethod: method.id,
      },
    });

    let labelUrl: string | undefined;
    let labelFormat: string | undefined;
    if (adapter.capabilities.generateLabel) {
      const label = await adapter.generateLabel(shipment.id);
      labelUrl = label.url;
      labelFormat = label.format;
    }

    await shipmentRepository.upsertForOrder({
      orderId: order.id,
      channelShipmentId: shipment.id,
      status: labelUrl ? "LABEL_CREATED" : shipment.status,
      fulfillmentType: providerId,
      carrier: shipment.carrier || providerId,
      trackingNumber: shipment.trackingNumber,
      metadata: {
        ...(shipment.metadata || {}),
        source: "LOGISTICS",
        fulfillmentMethod: method.id,
        logisticsProvider: providerId,
        logisticsConfigId: config?.logisticsConfigId || null,
        customerName: customer?.name || null,
        labelUrl: labelUrl || null,
        labelFormat: labelFormat || null,
        labelContentType: labelUrl ? "application/pdf" : null,
        awaitingPickupSchedule: Boolean(adapter.capabilities.schedulePickup),
      },
    });
    await this.setOrderStatus(order.id, "SHIPMENT_CREATED");

    if (["AMAZON", "FLIPKART", "SHOPIFY"].includes(channel)) {
      const channelAdapter = await channelManager.getAdapter(channel);
      await notifyMarketplaceSelfShip(channelAdapter, {
        channelOrderId: order.channelOrderId,
        trackingNumber: shipment.trackingNumber,
        carrier: shipment.carrier || providerId,
        orderStatus: "SHIPMENT_CREATED",
      });
    }

    return "SHIPMENT_CREATED";
  }

  async getPickupSlots(orderId: string) {
    const ctx = await this.resolveFulfillmentContext(orderId);
    if (ctx.mode === "CHANNEL_NATIVE") {
      const { order, shipment, method, channelAdapter, channel } = ctx;
      if (!method.capabilities?.pickupScheduling) {
        return {
          orderId: order.id,
          logisticsProvider: method.defaultLogisticsProvider || method.id,
          fulfillmentMethod: method.id,
          slots: [] as Array<{ id: string; label: string; startsAt: string; endsAt: string }>,
          canSchedule: false,
          reason: `${method.name} does not support pickup scheduling`,
        };
      }
      const slots = channelAdapter.getPickupSlots
        ? await channelAdapter.getPickupSlots(order.channelOrderId)
        : [];
      return {
        orderId: order.id,
        logisticsProvider: method.defaultLogisticsProvider || method.id,
        fulfillmentMethod: method.id,
        trackingNumber: shipment.trackingNumber,
        carrier: shipment.carrier || method.defaultLogisticsProvider || method.id,
        labelUrl:
          typeof shipment.metadata?.labelUrl === "string" ? String(shipment.metadata.labelUrl) : null,
        slots: slots.map((slot) => ({
          id: slot.id,
          label: `${new Date(slot.start).toLocaleString("en-IN")} – ${new Date(slot.end).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
          startsAt: slot.start,
          endsAt: slot.end,
          metadata: { channel, fulfillmentMethod: method.id },
        })),
        canSchedule: true,
      };
    }

    const { order, shipment, adapter, providerId, method } = ctx;
    if (!adapter.capabilities.schedulePickup) {
      return {
        orderId: order.id,
        logisticsProvider: providerId,
        fulfillmentMethod: method.id,
        slots: [] as Awaited<ReturnType<NonNullable<typeof adapter.getPickupSlots>>>,
        canSchedule: false,
        reason: "This logistics provider does not support pickup scheduling",
      };
    }
    const shipmentId = shipment.channelShipmentId || shipment.id;
    const slots = adapter.getPickupSlots
      ? await adapter.getPickupSlots(shipmentId)
      : [];
    return {
      orderId: order.id,
      logisticsProvider: providerId,
      fulfillmentMethod: method.id,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier || providerId,
      labelUrl:
        typeof shipment.metadata?.labelUrl === "string" ? String(shipment.metadata.labelUrl) : null,
      slots,
      canSchedule: true,
    };
  }

  async schedulePickup(
    orderId: string,
    input: { pickupSlotId?: string; pickupDate?: string }
  ): Promise<{ order: Awaited<ReturnType<typeof orderRepository.findById>>; pickupId: string }> {
    if (!input.pickupSlotId && !input.pickupDate) {
      throw new AppError("Select a pickup slot or date", 400);
    }

    const ctx = await this.resolveFulfillmentContext(orderId);
    const { order, shipment, method } = ctx;
    if (!["PACKED", "SHIPMENT_CREATED"].includes(order.status)) {
      throw new AppError(`Cannot schedule pickup from status ${order.status}`, 400);
    }

    if (ctx.mode === "CHANNEL_NATIVE") {
      if (!method.capabilities?.pickupScheduling) {
        throw new AppError(`${method.name} does not support pickup scheduling`, 400);
      }
      const result = await ctx.channelAdapter.fulfillOrder({
        channelOrderId: order.channelOrderId,
        action: method.id === "NFBF" || method.id === "FBF" ? "MARK_READY" : "SCHEDULE_PICKUP",
        pickupSlotId: input.pickupSlotId,
        trackingNumber: shipment.trackingNumber || undefined,
        carrier: method.defaultLogisticsProvider || method.id,
      });

      const pickupId =
        result.channelShipmentId ||
        `PU-${method.id}-${shipment.trackingNumber || order.id}`.slice(0, 48);

      await shipmentRepository.upsertForOrder({
        orderId: order.id,
        channelShipmentId: shipment.channelShipmentId || pickupId,
        status: "READY_FOR_PICKUP",
        fulfillmentType: method.id,
        carrier: shipment.carrier || method.defaultLogisticsProvider || method.id,
        trackingNumber: result.trackingNumber || shipment.trackingNumber,
        metadata: {
          source: "CHANNEL_NATIVE",
          fulfillmentMethod: method.id,
          pickupId,
          pickupScheduledAt: input.pickupDate || new Date().toISOString(),
          pickupSlotId: input.pickupSlotId || null,
          awaitingPickupSchedule: false,
        },
      });
      await this.setOrderStatus(order.id, "PICKUP_SCHEDULED");
      return {
        order: await orderRepository.findById(order.id),
        pickupId,
      };
    }

    const { adapter, providerId, config } = ctx;
    if (!adapter.capabilities.schedulePickup) {
      throw new AppError("This logistics provider does not support pickup scheduling", 400);
    }

    const credentials = decryptLogisticsCredentials(config?.logisticsCredentialsEncrypted) || {};
    await adapter.connect(credentials);

    const shipmentId = shipment.channelShipmentId || `${providerId}-${shipment.trackingNumber}`;
    const pickup = await adapter.schedulePickup({
      shipmentId,
      trackingNumber: shipment.trackingNumber || undefined,
      pickupSlotId: input.pickupSlotId,
      pickupDate: input.pickupDate,
    });

    await shipmentRepository.upsertForOrder({
      orderId: order.id,
      channelShipmentId: shipmentId,
      status: "READY_FOR_PICKUP",
      fulfillmentType: providerId,
      carrier: shipment.carrier || providerId,
      trackingNumber: shipment.trackingNumber,
      metadata: {
        fulfillmentMethod: method.id,
        logisticsProvider: providerId,
        pickupId: pickup.pickupId,
        pickupScheduledAt: pickup.scheduledAt,
        pickupSlotId: input.pickupSlotId || null,
        awaitingPickupSchedule: false,
      },
    });
    await this.setOrderStatus(order.id, "PICKUP_SCHEDULED");

    const channel = order.marketplace as ChannelType;
    if (["AMAZON", "FLIPKART", "SHOPIFY"].includes(String(channel))) {
      const channelAdapter = await channelManager.getAdapter(channel);
      await notifyMarketplaceSelfShip(channelAdapter, {
        channelOrderId: order.channelOrderId,
        trackingNumber: shipment.trackingNumber || undefined,
        carrier: shipment.carrier || providerId,
        orderStatus: "PICKUP_SCHEDULED",
      });
    }

    return {
      order: await orderRepository.findById(order.id),
      pickupId: pickup.pickupId,
    };
  }

  private async resolveFulfillmentContext(orderId: string) {
    const order = await orderRepository.findById(orderId);
    if (!order) throw new AppError("Order not found", 404);
    if (!order.channelConfigId) throw new AppError("Order has no sales channel connection", 400);

    const config = await channelRepository.findById(order.channelConfigId);
    if (!config) throw new AppError("Channel connection not found", 404);

    const channel = order.marketplace as ChannelType;
    const method = this.resolveMethod(channel, config.fulfillmentMethod);

    const shipments = await shipmentRepository.findByOrderId(order.id);
    const shipment = shipments[0];
    if (!shipment?.trackingNumber && !shipment?.channelShipmentId) {
      throw new AppError("No shipment found — pack the order first to create shipment and label", 400);
    }

    if (!method.requiresLogisticsProvider) {
      const channelAdapter = await channelManager.getAdapter(channel);
      if (!channelAdapter) {
        throw new AppError(`Sales channel adapter unavailable for ${channel}`, 500);
      }
      return {
        mode: "CHANNEL_NATIVE" as const,
        order,
        shipment,
        method,
        channel,
        channelAdapter,
        config,
      };
    }

    const providerId = config.logisticsProvider || defaultLogisticsProvider(channel);
    if (!logisticsRegistry.has(providerId)) {
      throw new AppError(`Logistics provider ${providerId} is not available`, 400);
    }
    const adapter = logisticsRegistry.get(providerId);
    const credentials = decryptLogisticsCredentials(config.logisticsCredentialsEncrypted) || {};
    await adapter.connect(credentials);

    return {
      mode: "EXTERNAL" as const,
      order,
      shipment,
      method,
      adapter,
      providerId,
      config,
    };
  }

  private async setOrderStatus(orderId: string, status: OrderStatus) {
    const stamps = timestampsForStatus(status);
    await orderRepository.updateStatus(orderId, status, stamps, "SYSTEM");
  }
}

export const fulfillmentService = new FulfillmentService();
