import { query, withTransaction } from "../config/db.js";
import { Order, OrderItem, OrderStatus } from "../models/domain.js";
import { furtherStatus, inferStatusFromTimestamps } from "../services/orderLifecycle.js";
import type pg from "pg";

function mapItem(row: Record<string, unknown>): OrderItem {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    productId: row.product_id ? String(row.product_id) : null,
    channelOrderItemId: row.channel_order_item_id ? String(row.channel_order_item_id) : null,
    channelProductId: row.channel_product_id ? String(row.channel_product_id) : null,
    channelSku: String(row.channel_sku),
    skuName: String(row.sku_name || ""),
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
  };
}

function mapOrder(row: Record<string, unknown>, items: OrderItem[] = []): Order {
  return {
    id: String(row.id),
    channelConfigId: row.channel_config_id ? String(row.channel_config_id) : null,
    channelOrderId: String(row.channel_order_id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    status: row.status as OrderStatus,
    lastStatusSource: row.last_status_source ? String(row.last_status_source) : null,
    totalAmount: Number(row.total_amount),
    currency: String(row.currency),
    marketplace: String(row.marketplace),
    packedAt: row.packed_at ? new Date(String(row.packed_at)).toISOString() : null,
    shippedAt: row.shipped_at ? new Date(String(row.shipped_at)).toISOString() : null,
    deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    items,
  };
}

export class OrderRepository {
  async list(): Promise<Order[]> {
    const orders = await query("SELECT * FROM orders ORDER BY created_at DESC");
    const items = await query("SELECT * FROM order_items");
    const byOrder = new Map<string, OrderItem[]>();
    for (const row of items.rows) {
      const item = mapItem(row);
      const list = byOrder.get(item.orderId) || [];
      list.push(item);
      byOrder.set(item.orderId, list);
    }
    return orders.rows.map((row) => mapOrder(row, byOrder.get(String(row.id)) || []));
  }

  async findById(id: string): Promise<Order | null> {
    const result = await query("SELECT * FROM orders WHERE id = $1", [id]);
    if (!result.rows[0]) return null;
    const items = await query("SELECT * FROM order_items WHERE order_id = $1", [id]);
    return mapOrder(result.rows[0], items.rows.map(mapItem));
  }

  async upsertNormalizedOrder(input: {
    channelConfigId: string;
    channelOrderId: string;
    marketplace: string;
    status: OrderStatus;
    totalAmount: number;
    currency: string;
    customerId?: string | null;
    createdAt?: string;
    items: Array<{
      channelOrderItemId?: string;
      channelProductId?: string;
      channelSku: string;
      skuName: string;
      quantity: number;
      unitPrice: number;
      productId?: string | null;
    }>;
  }): Promise<Order> {
    return withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT * FROM orders WHERE channel_config_id = $1 AND channel_order_id = $2`,
        [input.channelConfigId, input.channelOrderId]
      );

      let orderRow: Record<string, unknown>;
      if (existing.rows[0]) {
        const current = String(existing.rows[0].status) as OrderStatus;
        const incoming = input.status;
        const fromTimestamps = inferStatusFromTimestamps(current, {
          packedAt: existing.rows[0].packed_at ? String(existing.rows[0].packed_at) : null,
          shippedAt: existing.rows[0].shipped_at ? String(existing.rows[0].shipped_at) : null,
          deliveredAt: existing.rows[0].delivered_at ? String(existing.rows[0].delivered_at) : null,
        });
        const nextStatus =
          incoming === "CANCELLED" ? incoming : furtherStatus(furtherStatus(current, incoming), fromTimestamps);
        const updated = await client.query(
          `UPDATE orders SET
             status = $3,
             total_amount = $4,
             currency = $5,
             customer_id = COALESCE($6, customer_id),
             updated_at = NOW()
           WHERE channel_config_id = $1 AND channel_order_id = $2
           RETURNING *`,
          [
            input.channelConfigId,
            input.channelOrderId,
            nextStatus,
            input.totalAmount,
            input.currency,
            input.customerId || null,
          ]
        );
        orderRow = updated.rows[0];
      } else {
        const created = await client.query(
          `INSERT INTO orders (
             channel_config_id, channel_order_id, customer_id, status,
             total_amount, currency, marketplace, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz, NOW()))
           RETURNING *`,
          [
            input.channelConfigId,
            input.channelOrderId,
            input.customerId || null,
            input.status,
            input.totalAmount,
            input.currency,
            input.marketplace,
            input.createdAt || null,
          ]
        );
        orderRow = created.rows[0];
      }

      const orderId = String(orderRow.id);
      for (const item of input.items) {
        await client.query(
          `INSERT INTO order_items (
             order_id, product_id, channel_order_item_id, channel_product_id,
             channel_sku, sku_name, quantity, unit_price
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (order_id, channel_order_item_id) DO UPDATE SET
             quantity = EXCLUDED.quantity,
             unit_price = EXCLUDED.unit_price,
             sku_name = EXCLUDED.sku_name,
             product_id = COALESCE(EXCLUDED.product_id, order_items.product_id)`,
          [
            orderId,
            item.productId || null,
            item.channelOrderItemId || `${item.channelSku}-${item.quantity}`,
            item.channelProductId || null,
            item.channelSku,
            item.skuName,
            item.quantity,
            item.unitPrice,
          ]
        );
      }

      const items = await client.query("SELECT * FROM order_items WHERE order_id = $1", [orderId]);
      return mapOrder(orderRow, items.rows.map(mapItem));
    });
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    timestamps: Partial<{ packedAt: string; shippedAt: string; deliveredAt: string }> = {},
    statusSource?: string | null
  ): Promise<Order | null> {
    const result = await query(
      `UPDATE orders SET
         status = $2,
         packed_at = COALESCE($3::timestamptz, packed_at),
         shipped_at = COALESCE($4::timestamptz, shipped_at),
         delivered_at = COALESCE($5::timestamptz, delivered_at),
         last_status_source = COALESCE($6, last_status_source),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        status,
        timestamps.packedAt || null,
        timestamps.shippedAt || null,
        timestamps.deliveredAt || null,
        statusSource || null,
      ]
    );
    if (!result.rows[0]) return null;
    return this.findById(id);
  }

  async createManual(order: {
    id?: string;
    marketplace: string;
    status: OrderStatus;
    channelOrderId: string;
    items: Array<{ skuId: string; skuName: string; quantity: number; unitPrice?: number }>;
    packedAt?: string;
    shippedAt?: string;
    deliveredAt?: string;
    createdAt?: string;
  }): Promise<Order> {
    return withTransaction(async (client: pg.PoolClient) => {
      const created = await client.query(
        `INSERT INTO orders (
           id, channel_order_id, status, total_amount, currency, marketplace,
           packed_at, shipped_at, delivered_at, created_at
         ) VALUES (
           COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, 'INR', $5, $6, $7, $8, COALESCE($9::timestamptz, NOW())
         )
         RETURNING *`,
        [
          order.id && order.id.match(/^[0-9a-f-]{36}$/i) ? order.id : null,
          order.channelOrderId,
          order.status,
          0,
          order.marketplace,
          order.packedAt || null,
          order.shippedAt || null,
          order.deliveredAt || null,
          order.createdAt || null,
        ]
      );

      const orderId = String(created.rows[0].id);
      let total = 0;
      for (const item of order.items) {
        const product = await client.query("SELECT id, price FROM products WHERE sku = $1 OR id::text = $1", [
          item.skuId,
        ]);
        const unitPrice = item.unitPrice ?? Number(product.rows[0]?.price || 0);
        total += unitPrice * item.quantity;
        await client.query(
          `INSERT INTO order_items (
             order_id, product_id, channel_order_item_id, channel_sku, sku_name, quantity, unit_price
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            orderId,
            product.rows[0]?.id || null,
            `${order.channelOrderId}-${item.skuId}`,
            item.skuId,
            item.skuName,
            item.quantity,
            unitPrice,
          ]
        );
      }

      await client.query("UPDATE orders SET total_amount = $2 WHERE id = $1", [orderId, total]);
      const items = await client.query("SELECT * FROM order_items WHERE order_id = $1", [orderId]);
      const refreshed = await client.query("SELECT * FROM orders WHERE id = $1", [orderId]);
      return mapOrder(refreshed.rows[0], items.rows.map(mapItem));
    });
  }
}

export const orderRepository = new OrderRepository();
