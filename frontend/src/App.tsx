/**
 * Root application component.
 *
 * Sets up routing and the WebSocket data stream.
 * The stream connects once at the root level (rule: single data ingestion layer).
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { LivePage } from './pages/LivePage';
import { ReplayPage } from './pages/ReplayPage';
import { SessionsPage } from './pages/SessionsPage';
import { DevicesPage } from './pages/DevicesPage';
import { SettingsPage } from './pages/SettingsPage';
import { useStream } from './hooks/useStream';

function AppInner() {
  // Connect to the relay WebSocket — single connection for the entire app
  useStream();

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<LivePage />} />
        <Route path="/replay" element={<ReplayPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
