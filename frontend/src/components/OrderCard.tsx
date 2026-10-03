import { useState } from "react";
import { Order, OrderStatus, Marketplace } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { ChevronDown, ChevronUp, Package, Clock, Truck, CheckCircle2, AlertCircle, GripVertical, Download } from "lucide-react";
import { apiBaseUrl } from "@/lib/runtimeEnv";

function resolveAssetUrl(url?: string) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const base = apiBaseUrl();
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

function getMarketplaceBadgeVariant(marketplace: Marketplace) {
  switch (marketplace) {
    case Marketplace.AMAZON:
      return "warning";
    case Marketplace.SHOPIFY:
      return "success";
    case Marketplace.FLIPKART:
      return "info";
    default:
      return "secondary";
  }
}

function formatDate(isoString?: string) {
  if (!isoString) return "Pending...";
  const d = new Date(isoString);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} • ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export default function OrderCard({ 
  order, 
  expanded, 
  onToggle,
  onMoveToNext,
  nextStageName,
  onSchedulePickup,
}: { 
  order: Order;
  expanded?: boolean;
  onToggle?: () => void;
  onMoveToNext?: () => void;
  nextStageName?: string;
  onSchedulePickup?: () => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const isExpanded = expanded !== undefined ? expanded : internalExpanded;

  function handleToggle() {
    if (onToggle) onToggle();
    else setInternalExpanded(!internalExpanded);
  }

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("text/plain", order.id);
    e.dataTransfer.setData(`status-${order.status.toLowerCase()}`, "true");
  }

  // Sort items: Name (A-Z) -> ID -> Quantity (Desc)
  const sortedItems = [...order.items].sort((a, b) => {
    if (a.skuName !== b.skuName) return a.skuName.localeCompare(b.skuName);
    if (a.skuId !== b.skuId) return a.skuId.localeCompare(b.skuId);
    return b.quantity - a.quantity;
  });

  let cardClass = "bg-white dark:bg-neutral-950 border-gray-200 dark:border-neutral-800";
  if (order.status === OrderStatus.DELIVERED) {
    cardClass = "bg-green-50/50 dark:bg-green-900/10 border-green-200 dark:border-green-900/50";
  } else if (
    order.status === OrderStatus.DELIVERY_FAILED ||
    order.status === OrderStatus.RETURNED ||
    order.status === OrderStatus.CANCELLED
  ) {
    cardClass = "bg-red-50/50 dark:bg-red-900/10 border-red-200 dark:border-red-900/50";
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={`border rounded-xl shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing overflow-hidden group shrink-0 ${cardClass}`}
    >
      <div 
        className="p-4 flex items-center justify-between"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-1.5">
          <div className="touch-none cursor-grab active:cursor-grabbing p-1 -ml-1 text-gray-300 hover:text-gray-500 dark:text-neutral-600 dark:hover:text-neutral-400 transition-colors">
            <GripVertical className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-gray-900 dark:text-neutral-100 leading-tight">{order.id}</div>
            <div className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">{order.items.length} items</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={getMarketplaceBadgeVariant(order.marketplace)}>
            {order.marketplace}
          </Badge>
          <button className="text-gray-400 dark:text-neutral-500 group-hover:text-gray-600 dark:group-hover:text-neutral-300 transition-colors p-1 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800">
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-900/50 p-4 space-y-6 cursor-default" onClick={(e) => e.stopPropagation()} draggable={false} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          
          {/* Products */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Products</h4>
            <ul className="space-y-2">
              {sortedItems.map((it, idx) => (
                <li key={`${it.skuId}-${idx}`} className="flex justify-between items-center bg-white dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 px-3 py-2 rounded-lg text-sm">
                  <span className="font-medium text-gray-700 dark:text-neutral-200">{it.skuName} <span className="text-gray-400 dark:text-neutral-500 text-xs font-normal">({it.skuId})</span></span>
                  <span className="text-xs font-bold text-gray-600 dark:text-neutral-300 bg-gray-100 dark:bg-neutral-800 px-2 py-1 rounded">x{it.quantity}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Timeline */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Timeline</h4>
            <div className="relative pl-6 space-y-6 before:absolute before:inset-0 before:ml-[11px] before:-tranneutral-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-300 dark:before:via-neutral-700 before:to-transparent">
              
              <div className="relative flex items-start gap-4">
                <div className="absolute left-[-24px] bg-white dark:bg-neutral-950 rounded-full p-1 border-2 border-gray-900 dark:border-neutral-300 shadow-sm z-10">
                  <Package className="w-3 h-3 text-gray-900 dark:text-neutral-300" />
                </div>
                <div>
                  <h5 className="text-sm font-semibold text-gray-900 dark:text-neutral-100 leading-none mb-1">Created</h5>
                  <p className="text-xs text-gray-500 dark:text-neutral-400">{formatDate(order.createdAt)}</p>
                </div>
              </div>

              <div className="relative flex items-start gap-4">
                <div className={`absolute left-[-24px] bg-white dark:bg-neutral-950 rounded-full p-1 border-2 shadow-sm z-10 ${order.packedAt ? 'border-gray-900 dark:border-neutral-300' : 'border-gray-300 dark:border-neutral-700'}`}>
                  <Clock className={`w-3 h-3 ${order.packedAt ? 'text-gray-900 dark:text-neutral-300' : 'text-gray-300 dark:text-neutral-700'}`} />
                </div>
                <div>
                  <h5 className={`text-sm font-semibold leading-none mb-1 ${order.packedAt ? 'text-gray-900 dark:text-neutral-100' : 'text-gray-400 dark:text-neutral-600'}`}>Packed</h5>
                  <p className="text-xs text-gray-500 dark:text-neutral-400">{formatDate(order.packedAt)}</p>
                </div>
              </div>

              <div className="relative flex items-start gap-4">
                <div className={`absolute left-[-24px] bg-white dark:bg-neutral-950 rounded-full p-1 border-2 shadow-sm z-10 ${order.shippedAt ? 'border-gray-900 dark:border-neutral-300' : 'border-gray-300 dark:border-neutral-700'}`}>
                  <Truck className={`w-3 h-3 ${order.shippedAt ? 'text-gray-900 dark:text-neutral-300' : 'text-gray-300 dark:text-neutral-700'}`} />
                </div>
                <div>
                  <h5 className={`text-sm font-semibold leading-none mb-1 ${order.shippedAt ? 'text-gray-900 dark:text-neutral-100' : 'text-gray-400 dark:text-neutral-600'}`}>Shipped</h5>
                  <p className="text-xs text-gray-500 dark:text-neutral-400">{formatDate(order.shippedAt)}</p>
                </div>
              </div>

              {(order.status === OrderStatus.DELIVERY_FAILED ||
                order.status === OrderStatus.RETURNED ||
                order.status === OrderStatus.DELIVERED) && (
                <div className="relative flex items-start gap-4">
                  <div className={`absolute left-[-24px] bg-white dark:bg-neutral-950 rounded-full p-1 border-2 shadow-sm z-10 ${order.status === OrderStatus.DELIVERED ? 'border-green-600 dark:border-green-500' : 'border-red-600 dark:border-red-500'}`}>
                    {order.status === OrderStatus.DELIVERED ? (
                      <CheckCircle2 className="w-3 h-3 text-green-600 dark:text-green-500" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-red-600 dark:text-red-500" />
                    )}
                  </div>
                  <div>
                    <h5 className={`text-sm font-semibold leading-none mb-1 ${order.status === OrderStatus.DELIVERED ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                      {order.status === OrderStatus.DELIVERED
                        ? "Delivered"
                        : order.status === OrderStatus.RETURNED
                          ? "Returned"
                          : "Failed delivery"}
                    </h5>
                    <p className="text-xs text-gray-500 dark:text-neutral-400">{formatDate(order.deliveredAt)}</p>
                  </div>
                </div>
              )}

            </div>
          </div>

          {(order.trackingNumber || order.labelUrl) && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Shipment</h4>
              <div className="bg-white dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-lg px-3 py-3 space-y-2 text-sm">
                {order.carrier && (
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500 dark:text-neutral-400">Carrier</span>
                    <span className="font-medium text-gray-800 dark:text-neutral-200">{order.carrier}</span>
                  </div>
                )}
                {order.trackingNumber && (
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500 dark:text-neutral-400">AWB</span>
                    <span className="font-mono text-xs font-medium text-gray-800 dark:text-neutral-200">{order.trackingNumber}</span>
                  </div>
                )}
                {resolveAssetUrl(order.labelUrl) && (
                  <a
                    href={resolveAssetUrl(order.labelUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                  >
                    <Download className="h-4 w-4" />
                    Download shipping label
                  </a>
                )}
                {onSchedulePickup && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSchedulePickup();
                    }}
                    className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-neutral-700 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-neutral-100 hover:bg-gray-50 dark:hover:bg-neutral-900"
                  >
                    <Truck className="h-4 w-4" />
                    Schedule pickup
                  </button>
                )}
              </div>
            </div>
          )}

          {onSchedulePickup && !(order.trackingNumber || order.labelUrl) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSchedulePickup();
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-300 dark:border-neutral-700 text-sm font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-900"
            >
              <Truck className="h-4 w-4" />
              Schedule pickup
            </button>
          )}

          {/* Move to next stage button */}
          {onMoveToNext && nextStageName && (
            <div className="pt-2 border-t border-gray-100 dark:border-neutral-800">
              <button 
                onClick={(e) => { e.stopPropagation(); onMoveToNext(); }}
                className="w-full flex items-center justify-center py-2.5 bg-gray-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-semibold rounded-lg hover:bg-gray-800 dark:hover:bg-white transition-colors"
              >
                Move to {nextStageName}
              </button>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
