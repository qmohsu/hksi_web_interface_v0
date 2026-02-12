/**
 * Alerts panel — collapsible event log on the live page.
 *
 * Shows a reverse-chronological list of all events (crossings, OCS,
 * risk alerts, start signals) with timestamps and acknowledgment.
 */

import { useState, useMemo } from 'react';
import { useStore } from '../../stores/useStore';
import { formatTime } from '../../lib/formatters';

const EVENT_BADGES: Record<string, { bg: string; label: string }> = {
  CROSSING: { bg: 'bg-red-500', label: 'CROSSING' },
  OCS: { bg: 'bg-red-700', label: 'OCS' },
  RISK_ALERT: { bg: 'bg-orange-500', label: 'RISK' },
  START_SIGNAL: { bg: 'bg-blue-600', label: 'START' },
  DEVICE_OFFLINE: { bg: 'bg-gray-500', label: 'OFFLINE' },
  DEVICE_ONLINE: { bg: 'bg-green-500', label: 'ONLINE' },
};

export function AlertsPanel() {
  const events = useStore((s) => s.events);
  const [expanded, setExpanded] = useState(true);
  const [acknowledged, setAcknowledged] = useState<Set<number>>(new Set());

  const sortedEvents = useMemo(
    () => [...events].reverse(),
    [events]
  );

  const unackedCount = events.length - acknowledged.size;

  const acknowledgeAll = () => {
    setAcknowledged(new Set(events.map((_, i) => i)));
  };

  return (
    <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
      {/* Header */}
      <div
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-600 uppercase">
            Events
          </span>
          {unackedCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold text-white bg-red-500 rounded-full">
              {unackedCount > 99 ? '99+' : unackedCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unackedCount > 0 && (
            <button
              className="text-[10px] text-blue-500 hover:text-blue-600 font-medium"
              onClick={(e) => {
                e.stopPropagation();
                acknowledgeAll();
              }}
            >
              Ack all
            </button>
          )}
          <span className="text-slate-400 text-xs">{expanded ? '\u25B2' : '\u25BC'}</span>
        </div>
      </div>

      {/* Event list */}
      {expanded && (
        <div className="max-h-[180px] overflow-y-auto divide-y divide-slate-100">
          {sortedEvents.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-400">
              No events yet
            </div>
          ) : (
            sortedEvents.map((event, idx) => {
              const badge = EVENT_BADGES[event.event_kind] ?? EVENT_BADGES['CROSSING'];
              const eventIdx = events.length - 1 - idx;
              const isAcked = acknowledged.has(eventIdx);

              return (
                <div
                  key={`${event.ts_ms}-${event.event_kind}-${idx}`}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                    isAcked ? 'opacity-50' : ''
                  }`}
                >
                  <span className="text-[10px] text-slate-400 font-mono min-w-[60px]">
                    {formatTime(event.ts_ms)}
                  </span>
                  <span
                    className={`${badge.bg} text-white text-[9px] font-bold px-1.5 py-0.5 rounded`}
                  >
                    {badge.label}
                  </span>
                  <span className="text-slate-700 truncate flex-1">
                    {event.name ?? event.athlete_id ?? '—'}
                  </span>
                  {!isAcked && (
                    <button
                      className="text-blue-500 hover:text-blue-600 text-[10px] font-medium"
                      onClick={() =>
                        setAcknowledged((prev) => new Set([...prev, eventIdx]))
                      }
                    >
                      Ack
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
