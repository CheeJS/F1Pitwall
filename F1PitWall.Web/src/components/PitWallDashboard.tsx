import { useState } from 'react';
import { useHistoricalData } from '../hooks/useHistoricalData';
import { RaceReplay } from './RaceReplay';
import { ExplorerSidebar, type EndpointId } from './ExplorerSidebar';
import { DataExplorer } from './DataExplorer';

interface Props {
  historical: ReturnType<typeof useHistoricalData>;
  highlightedDriver: number | null;
  onSelectDriver: (n: number | null) => void;
}

export function PitWallDashboard({ historical, highlightedDriver, onSelectDriver }: Props) {
  const [activeEndpoint, setActiveEndpoint] = useState<EndpointId>('team_radio');

  return (
    <div className="pitwall-layout" style={{ display: 'flex', width: '100%', height: '100%' }}>
      
      {/* 
        We rely on RaceReplay's internal CSS modifications 
        (pitwall-grid-active) to construct the grid.
      */}
      <RaceReplay
        highlightedDriver={highlightedDriver}
        onSelectDriver={onSelectDriver}
        initialSessionKey={historical.selectedSession?.sessionKey}
        isPitWall={true}
      >
        <div className="pitwall-data-pane" style={{ display: 'flex', flexDirection: 'row' }}>
          <ExplorerSidebar 
            active={activeEndpoint} 
            onChange={id => setActiveEndpoint(id)} 
          />
          <div style={{ flex: 1, position: 'relative' }}>
            <DataExplorer 
              endpointId={activeEndpoint} 
              presetSessionKey={historical.selectedSession?.sessionKey}
              presetDriverNum={highlightedDriver}
            />
          </div>
        </div>
      </RaceReplay>

    </div>
  );
}
