/**
 * Live page — the primary coaching view.
 *
 * Two-pane layout matching the stakeholder GUI pattern:
 *   Left: RankingBoard (athlete list / start board)
 *   Right: MapView (tracks + labels + start line)
 */

import { RankingBoard } from '../components/board/RankingBoard';
import { MapView } from '../components/map/MapView';

export function LivePage() {
  return (
    <div className="flex h-full gap-2 p-2">
      {/* Left pane: Ranking board (~40% width) */}
      <div className="w-2/5 min-w-[360px] flex-shrink-0">
        <RankingBoard />
      </div>

      {/* Right pane: Map (~60% width) */}
      <div className="flex-1">
        <MapView />
      </div>
    </div>
  );
}
