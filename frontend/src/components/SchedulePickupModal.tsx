import { useEffect, useState } from "react";
import { Order } from "@/types";
import { Button } from "@/components/ui/Button";
import { X, Truck } from "lucide-react";
import { getPickupSlots, PickupSlotsResponse, schedulePickup } from "@/services/order.service";
import { apiBaseUrl } from "@/lib/runtimeEnv";

function resolveAssetUrl(url?: string | null) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const base = apiBaseUrl();
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

export default function SchedulePickupModal({
  order,
  open,
  onClose,
  onScheduled,
}: {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onScheduled: (order: Order) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PickupSlotsResponse | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string>("");
  const [customDate, setCustomDate] = useState("");

  useEffect(() => {
    if (!open || !order) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedSlotId("");
    setCustomDate("");
    setData(null);
    void getPickupSlots(order.id)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        if (res.slots[0]) setSelectedSlotId(res.slots[0].id);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load pickup slots");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, order?.id]);

  if (!open || !order) return null;

  async function submit() {
    if (!order) return;
    setError(null);
    if (!selectedSlotId && !customDate) {
      setError("Select a pickup slot or choose a custom date/time");
      return;
    }
    setSubmitting(true);
    try {
      const updated = await schedulePickup(order.id, {
        pickupSlotId: selectedSlotId || undefined,
        pickupDate: customDate ? new Date(customDate).toISOString() : undefined,
      });
      onScheduled(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule pickup");
    } finally {
      setSubmitting(false);
    }
  }

  const labelUrl = resolveAssetUrl(data?.labelUrl || order.labelUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-labelledby="schedule-pickup-title"
        className="w-full max-w-lg rounded-xl bg-white dark:bg-neutral-950 border border-gray-200 dark:border-neutral-800 shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4 text-gray-700 dark:text-neutral-300" />
            <h2 id="schedule-pickup-title" className="text-base font-semibold text-gray-900 dark:text-neutral-100">
              Schedule pickup
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-neutral-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-neutral-400">
            Order <span className="font-medium text-gray-900 dark:text-neutral-100">{order.id}</span>
            {data?.logisticsProvider ? (
              <>
                {" "}
                ·{" "}
                <span className="font-medium text-gray-900 dark:text-neutral-100">
                  {data.logisticsProvider}
                </span>
              </>
            ) : null}
          </p>

          {(data?.trackingNumber || order.trackingNumber) && (
            <div className="text-sm flex justify-between gap-3">
              <span className="text-gray-500">AWB</span>
              <span className="font-mono text-xs">{data?.trackingNumber || order.trackingNumber}</span>
            </div>
          )}

          {labelUrl && (
            <a
              href={labelUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm font-medium text-gray-900 dark:text-neutral-100 underline underline-offset-2"
            >
              Open shipping label
            </a>
          )}

          {loading && <p className="text-sm text-gray-500">Loading pickup windows…</p>}

          {!loading && data && !data.canSchedule && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {data.reason || "Pickup scheduling is not available for this provider."}
            </p>
          )}

          {!loading && data?.canSchedule && (
            <>
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-neutral-300">
                  Available slots
                </label>
                <div className="max-h-48 overflow-y-auto space-y-2">
                  {data.slots.map((slot) => (
                    <label
                      key={slot.id}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer text-sm ${
                        selectedSlotId === slot.id
                          ? "border-gray-900 dark:border-neutral-200 bg-gray-50 dark:bg-neutral-900"
                          : "border-gray-200 dark:border-neutral-800"
                      }`}
                    >
                      <input
                        type="radio"
                        name="pickupSlot"
                        checked={selectedSlotId === slot.id}
                        onChange={() => {
                          setSelectedSlotId(slot.id);
                          setCustomDate("");
                        }}
                        className="mt-1"
                      />
                      <span className="text-gray-800 dark:text-neutral-200">{slot.label}</span>
                    </label>
                  ))}
                  {!data.slots.length && (
                    <p className="text-sm text-gray-500">No provider slots — use a custom date/time.</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-neutral-300">
                  Or custom date/time
                </label>
                <input
                  type="datetime-local"
                  value={customDate}
                  onChange={(e) => {
                    setCustomDate(e.target.value);
                    if (e.target.value) setSelectedSlotId("");
                  }}
                  className="w-full text-sm border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 bg-white dark:bg-neutral-900"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-neutral-800">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || loading || Boolean(data && !data.canSchedule)}
          >
            {submitting ? "Scheduling…" : "Confirm pickup"}
          </Button>
        </div>
      </div>
    </div>
  );
}
