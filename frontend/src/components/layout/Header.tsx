/**
 * Global header bar — always visible.
 *
 * Shows: session status, connection indicator, current time,
 * and navigation links.
 */

import { NavLink } from 'react-router-dom';
import { useStore } from '../../stores/useStore';
import { formatTime } from '../../lib/formatters';
import { useEffect, useState } from 'react';

const NAV_ITEMS = [
  { to: '/', label: 'Live' },
  { to: '/replay', label: 'Replay' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/devices', label: 'Devices' },
  { to: '/settings', label: 'Settings' },
] as const;

const STATUS_INDICATOR: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  disconnected: 'bg-red-500',
};

export function Header() {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const sessionId = useStore((s) => s.sessionId);
  const heartbeat = useStore((s) => s.heartbeat);
  const [now, setNow] = useState(Date.now());

  // Update clock every second
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between shadow-lg">
      {/* Left: Logo + session info */}
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-tight">
          HKSI Coach Monitor
        </h1>
        <span className="text-xs px-2 py-0.5 rounded bg-slate-700 font-mono">
          {sessionId ?? 'NO SESSION'}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_INDICATOR[connectionStatus]}`}
          />
          <span className="text-xs text-slate-300 capitalize">
            {connectionStatus}
          </span>
        </div>
        {heartbeat && (
          <span className="text-xs text-slate-400">
            {heartbeat.athletes_tracked} athletes
          </span>
        )}
      </div>

      {/* Center: Navigation */}
      <nav className="flex gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Right: Clock */}
      <div className="text-sm font-mono text-slate-300">
        {formatTime(now)}
      </div>
    </header>
  );
}
