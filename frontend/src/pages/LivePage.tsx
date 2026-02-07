/**
 * Live page — the primary coaching view.
 *
 * Two-pane layout matching the stakeholder GUI pattern:
 *   Left: RankingBoard (athlete list / start board) + AlertsPanel
 *   Right: MapView (tracks + labels + start line)
 *   Toasts: overlay for real-time event notifications
 */

import { RankingBoard } from '../components/board/RankingBoard';
import { MapView } from '../components/map/MapView';
import { AlertsPanel } from '../components/alerts/AlertsPanel';
import { AlertToast } from '../components/alerts/AlertToast';

export function LivePage() {
  return (
    <div className="flex h-full gap-2 p-2">
      {/* Left pane: Ranking board + Alerts (~40% width) */}
      <div className="w-2/5 min-w-[360px] flex-shrink-0 flex flex-col gap-2">
        <div className="flex-1 min-h-0">
          <RankingBoard />
        </div>
        <AlertsPanel />
      </div>

      {/* Right pane: Map (~60% width) */}
      <div className="flex-1">
        <MapView />
      </div>

      {/* Toast overlay */}
      <AlertToast />
    </div>
  );
}
