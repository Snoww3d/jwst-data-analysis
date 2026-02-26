import { useState } from 'react';
import type { MastObservationResult } from '../../types/MastTypes';
import './ObservationList.css';

interface ObservationListProps {
  observations: MastObservationResult[];
}

/**
 * Collapsible list of MAST observations for a target.
 * Shows instrument, filter, exposure time, and calibration level.
 */
export function ObservationList({ observations }: ObservationListProps) {
  const [expanded, setExpanded] = useState(false);

  if (observations.length === 0) return null;

  return (
    <section className="observation-list">
      <button
        className="observation-list-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="observation-table"
      >
        <span>
          Available Observations ({observations.length} file{observations.length !== 1 ? 's' : ''})
        </span>
        <span className={`observation-list-chevron ${expanded ? 'chevron-up' : ''}`}>&#x25BE;</span>
      </button>

      {expanded && (
        <div id="observation-table" className="observation-list-table-wrap">
          <table className="observation-list-table">
            <thead>
              <tr>
                <th>Observation ID</th>
                <th>Instrument</th>
                <th>Filter</th>
                <th>Exposure (s)</th>
                <th>Calib Level</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((obs, i) => (
                <tr key={obs.obs_id ?? `obs-${i}`}>
                  <td className="obs-id-cell">{obs.obs_id ?? '--'}</td>
                  <td>{obs.instrument_name ?? '--'}</td>
                  <td>
                    <code>{obs.filters ?? '--'}</code>
                  </td>
                  <td>{obs.t_exptime != null ? obs.t_exptime.toFixed(1) : '--'}</td>
                  <td>{obs.calib_level ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
