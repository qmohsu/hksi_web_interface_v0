/**
 * Root layout wrapper with Header and content area.
 */

import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { useStore } from '../../stores/useStore';

export function AppLayout() {
  const connectionStatus = useStore((s) => s.connectionStatus);

  return (
    <div className="flex flex-col h-screen bg-slate-100">
      <Header />

      {/* Disconnected banner */}
      {connectionStatus === 'disconnected' && (
        <div className="bg-red-600 text-white text-center text-sm py-1 font-medium">
          Disconnected from relay — showing last known state. Reconnecting...
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
