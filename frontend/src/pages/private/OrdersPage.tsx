import { useContext, useEffect, useMemo, useState } from "react";
import { AppContext } from "@/context/AppContext";
import { Marketplace, Order, OrderStatus } from "@/types";
import { PageHeader } from "@/components/ui/PageHeader";
import OrderColumn from "@/components/OrderColumn";
import OrderCard from "@/components/OrderCard";
import SchedulePickupModal from "@/components/SchedulePickupModal";
import { getChannels } from "@/services/channel.service";
import { useRealtimeEvents } from "@/hooks/useRealtimeEvents";

const columns = [
  {
    id: OrderStatus.READY_TO_PACK,
    title: "Ready to Pack",
    statuses: [OrderStatus.NEW, OrderStatus.CONFIRMED, OrderStatus.READY_TO_PACK],
  },
  { id: OrderStatus.PACKED, title: "Packed", statuses: [OrderStatus.PACKED] },
  {
    id: "LOGISTICS_SETUP",
    title: "Shipment / Pickup",
    statuses: [OrderStatus.SHIPMENT_CREATED, OrderStatus.PICKUP_SCHEDULED],
  },
  {
    id: "IN_LOGISTICS",
    title: "In Transit",
    statuses: [OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT, OrderStatus.OUT_FOR_DELIVERY],
  },
  {
    id: "CLOSED",
    title: "Closed",
    statuses: [
      OrderStatus.DELIVERED,
      OrderStatus.DELIVERY_FAILED,
      OrderStatus.RETURN_REQUESTED,
      OrderStatus.RETURNED,
      OrderStatus.CANCELLED,
    ],
  },
];

type ChannelFilter = "ALL" | Marketplace | string;

export default function OrdersPage() {
  const ctx = useContext(AppContext);
  const orders = ctx?.state.orders || [];
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, string | null>>({});
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("ALL");
  const [connectedChannels, setConnectedChannels] = useState<string[]>([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [scheduleOrder, setScheduleOrder] = useState<Order | null>(null);

  const channelFilters = useMemo<ChannelFilter[]>(
    () => ["ALL", ...connectedChannels],
    [connectedChannels]
  );

  async function refreshChannels() {
    try {
      const channels = await getChannels();
      setConnectedChannels(
        channels.filter((c) => c.status === "CONNECTED").map((c) => c.channel)
      );
    } catch {
      setConnectedChannels([]);
    } finally {
      setChannelsLoaded(true);
    }
  }

  useEffect(() => {
    void refreshChannels();
  }, []);

  useRealtimeEvents((event) => {
    if (event.type === "channel.status" || event.type === "channel.sync") {
      void refreshChannels();
    }
  });

  useEffect(() => {
    if (!channelsLoaded) return;
    if (channelFilter !== "ALL" && !connectedChannels.includes(channelFilter)) {
      setChannelFilter("ALL");
    }
  }, [channelFilter, connectedChannels, channelsLoaded]);

  function showToast(msg: string, ms = 3000) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), ms);
  }

  async function handlePack(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    if (!order || !ctx?.updateOrder) return;

    try {
      await ctx.updateOrder({
        ...order,
        status: OrderStatus.PACKED,
        packedAt: new Date().toISOString(),
      });
      showToast("Packed — move to Shipment / Pickup to generate the label.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to mark packed", 10000);
      await ctx.loadOrders();
    }
  }

  async function handleCreateShipment(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    if (!order || !ctx?.updateOrder) return;

    try {
      const updated = await ctx.updateOrder({
        ...order,
        status: OrderStatus.SHIPMENT_CREATED,
      });
      if (updated) {
        setScheduleOrder(updated);
        showToast("Label created — schedule pickup.");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create shipment / label", 10000);
      await ctx.loadOrders();
    }
  }

  async function handleDropOrder(orderId: string, targetStatus: OrderStatus | string) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    if (order.status === targetStatus) return;

    const from = order.status;
    const to = targetStatus as OrderStatus;

    if (
      (from === OrderStatus.READY_TO_PACK ||
        from === OrderStatus.NEW ||
        from === OrderStatus.CONFIRMED) &&
      to === OrderStatus.PACKED
    ) {
      await handlePack(orderId);
      return;
    }

    if (
      from === OrderStatus.PACKED &&
      (to === OrderStatus.SHIPMENT_CREATED || String(targetStatus) === "LOGISTICS_SETUP")
    ) {
      await handleCreateShipment(orderId);
      return;
    }

    showToast("Use Schedule Pickup on the order, or Simulation for later logistics steps.");
  }

  const getNextStatus = (status: string) => {
    if (
      status === OrderStatus.READY_TO_PACK ||
      status === OrderStatus.NEW ||
      status === OrderStatus.CONFIRMED
    ) {
      return OrderStatus.PACKED;
    }
    if (status === OrderStatus.PACKED) {
      return OrderStatus.SHIPMENT_CREATED;
    }
    return null;
  };

  const getBoardStatus = (order: Order): OrderStatus => {
    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.DELIVERED ||
      order.status === OrderStatus.DELIVERY_FAILED ||
      order.status === OrderStatus.RETURN_REQUESTED ||
      order.status === OrderStatus.RETURNED
    ) {
      return order.status;
    }
    if (
      order.shippedAt ||
      order.status === OrderStatus.PICKED_UP ||
      order.status === OrderStatus.IN_TRANSIT ||
      order.status === OrderStatus.OUT_FOR_DELIVERY
    ) {
      return order.status === OrderStatus.OUT_FOR_DELIVERY
        ? OrderStatus.OUT_FOR_DELIVERY
        : OrderStatus.IN_TRANSIT;
    }
    if (
      order.status === OrderStatus.SHIPMENT_CREATED ||
      order.status === OrderStatus.PICKUP_SCHEDULED ||
      Boolean(order.trackingNumber)
    ) {
      return order.status === OrderStatus.PICKUP_SCHEDULED
        ? OrderStatus.PICKUP_SCHEDULED
        : OrderStatus.SHIPMENT_CREATED;
    }
    if (order.packedAt || order.status === OrderStatus.PACKED) {
      return OrderStatus.PACKED;
    }
    return order.status;
  };

  const filteredOrders = useMemo(() => {
    return [...orders]
      .filter((o) => (channelFilter === "ALL" ? true : o.marketplace === channelFilter))
      .filter((o) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          o.id.toLowerCase().includes(q) ||
          o.marketplace.toLowerCase().includes(q) ||
          o.items.some((it) => it.skuName.toLowerCase().includes(q) || it.skuId.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return a.id.localeCompare(b.id);
      });
  }, [orders, channelFilter, query]);

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader title="Orders" />

      <div className="flex flex-wrap items-center gap-3 px-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search orders…"
          className="text-sm border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-1.5 bg-white dark:bg-neutral-900 min-w-[200px]"
        />
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="text-sm border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-1.5 bg-white dark:bg-neutral-900"
        >
          {channelFilters.map((c) => (
            <option key={c} value={c}>
              {c === "ALL" ? "All channels" : c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 flex-1 min-h-0">
        {columns.map((col) => {
          const colOrders = filteredOrders.filter((o) => col.statuses.includes(getBoardStatus(o)));
          return (
            <OrderColumn
              key={col.id}
              status={col.id}
              title={col.title}
              count={colOrders.length}
              onDropOrder={handleDropOrder}
            >
              {colOrders.map((order) => {
                const boardStatus = getBoardStatus(order);
                const next = getNextStatus(boardStatus);
                return (
                  <OrderCard
                    key={order.id}
                    order={order}
                    expanded={expandedCardIds[col.id] === order.id}
                    onToggle={() =>
                      setExpandedCardIds((prev) => ({
                        ...prev,
                        [col.id]: prev[col.id] === order.id ? null : order.id,
                      }))
                    }
                    nextStageName={
                      next === OrderStatus.PACKED
                        ? "Mark Packed"
                        : next === OrderStatus.SHIPMENT_CREATED
                          ? "Create shipment"
                          : undefined
                    }
                    onMoveToNext={
                      next === OrderStatus.PACKED
                        ? () => void handlePack(order.id)
                        : next === OrderStatus.SHIPMENT_CREATED
                          ? () => void handleCreateShipment(order.id)
                          : undefined
                    }
                    onSchedulePickup={
                      boardStatus === OrderStatus.SHIPMENT_CREATED
                        ? () => setScheduleOrder(order)
                        : undefined
                    }
                  />
                );
              })}
            </OrderColumn>
          );
        })}
      </div>

      <SchedulePickupModal
        order={scheduleOrder}
        open={Boolean(scheduleOrder)}
        onClose={() => setScheduleOrder(null)}
        onScheduled={async () => {
          await ctx?.loadOrders();
          showToast("Pickup scheduled");
        }}
      />

      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-neutral-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 max-w-md">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
