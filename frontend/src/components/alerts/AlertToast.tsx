/**
 * Toast notification system for real-time event alerts.
 *
 * Shows slide-in toasts for crossing, OCS, and risk events.
 * Auto-dismisses after a configurable timeout.
 */

import { useEffect, useState, useCallback } from 'react';
import { useStore } from '../../stores/useStore';
import type { EventPayload } from '../../contracts/messages';

interface Toast {
  id: string;
  event: EventPayload & { ts_ms: number };
  createdAt: number;
}

const TOAST_DURATION_MS = 6000;
const MAX_TOASTS = 5;

const EVENT_STYLES: Record<string, { bg: string; icon: string; label: string }> = {
  CROSSING: { bg: 'bg-red-500', icon: '\u2716', label: 'Line Crossed' },
  OCS: { bg: 'bg-red-700', icon: '\u26D4', label: 'OCS' },
  RISK_ALERT: { bg: 'bg-orange-500', icon: '\u26A0', label: 'Risk Alert' },
  START_SIGNAL: { bg: 'bg-blue-600', icon: '\u25B6', label: 'Start Signal' },
  DEVICE_OFFLINE: { bg: 'bg-gray-500', icon: '\u25CF', label: 'Device Offline' },
  DEVICE_ONLINE: { bg: 'bg-green-500', icon: '\u2714', label: 'Device Online' },
};

export function AlertToast() {
  const events = useStore((s) => s.events);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastEventCount, setLastEventCount] = useState(0);

  // Watch for new events and create toasts
  useEffect(() => {
    if (events.length > lastEventCount) {
      const newEvents = events.slice(lastEventCount);
      const newToasts: Toast[] = newEvents.map((evt, i) => ({
        id: `${evt.ts_ms}-${evt.event_kind}-${i}-${Date.now()}`,
        event: evt,
        createdAt: Date.now(),
      }));
      setToasts((prev) => [...prev, ...newToasts].slice(-MAX_TOASTS));
    }
    setLastEventCount(events.length);
  }, [events, lastEventCount]);

  // Auto-dismiss timer
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.createdAt < TOAST_DURATION_MS));
    }, 500);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 right-4 z-[2000] space-y-2 pointer-events-auto">
      {toasts.map((toast) => {
        const style = EVENT_STYLES[toast.event.event_kind] ?? EVENT_STYLES['CROSSING'];
        const age = Date.now() - toast.createdAt;
        const opacity = age > TOAST_DURATION_MS - 1000 ? 0.5 : 1;

        return (
          <div
            key={toast.id}
            className={`${style.bg} text-white rounded-lg shadow-xl px-4 py-2.5 min-w-[260px] max-w-[340px] flex items-start gap-3 cursor-pointer transition-all animate-slide-in`}
            style={{ opacity }}
            onClick={() => dismiss(toast.id)}
          >
            <span className="text-xl mt-0.5">{style.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{style.label}</div>
              {toast.event.name && (
                <div className="text-xs opacity-90 truncate">
                  {toast.event.name}
                  {toast.event.athlete_id && ` (${toast.event.athlete_id})`}
                </div>
              )}
              {toast.event.details?.confidence != null && (
                <div className="text-[10px] opacity-75">
                  Confidence: {((toast.event.details.confidence as number) * 100).toFixed(0)}%
                </div>
              )}
            </div>
            <button
              className="text-white/70 hover:text-white text-xs ml-1"
              onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
            >
              \u2715
            </button>
          </div>
        );
      })}
    </div>
  );
}
