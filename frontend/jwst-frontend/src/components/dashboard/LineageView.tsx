import React from 'react';
import {
  JwstDataModel,
  ProcessingLevelColors,
  ProcessingLevelLabels,
} from '../../types/JwstDataTypes';
import { formatFileSize } from '../../utils/formatUtils';
import { TrashIcon, ArchiveIcon } from '../icons/DashboardIcons';
import LineageFileCard from './LineageFileCard';
import './LineageView.css';

interface LineageViewProps {
  filteredData: JwstDataModel[];
  collapsedLineages: Set<string>;
  expandedLevels: Set<string>;
  selectedFiles: Set<string>;
  onToggleLineage: (obsId: string) => void;
  onToggleLevel: (key: string) => void;
  onDeleteObservation: (obsId: string, event: React.MouseEvent) => void;
  onDeleteLevel: (obsId: string, level: string, event: React.MouseEvent) => void;
  onArchiveLevel: (obsId: string, level: string, event: React.MouseEvent) => void;
  isArchivingLevel: boolean;
  onFileSelect: (dataId: string, event: React.MouseEvent) => void;
  onView: (item: JwstDataModel) => void;
  onProcess: (dataId: string, algorithm: string) => void;
}

const LEVEL_ORDER = ['L1', 'L2a', 'L2b', 'L3', 'unknown'];

const groupByLineage = (items: JwstDataModel[]) => {
  const lineageGroups: Record<string, Record<string, JwstDataModel[]>> = {};

  items.forEach((item) => {
    const obsId = item.observationBaseId || item.metadata?.mast_obs_id || 'Manual Uploads';
    const level = item.processingLevel || 'unknown';

    if (!lineageGroups[obsId]) {
      lineageGroups[obsId] = {};
    }
    if (!lineageGroups[obsId][level]) {
      lineageGroups[obsId][level] = [];
    }
    lineageGroups[obsId][level].push(item);
  });

  return lineageGroups;
};

const getProcessingLevelColor = (level: string) => {
  return ProcessingLevelColors[level] || ProcessingLevelColors['unknown'];
};

const getProcessingLevelLabel = (level: string) => {
  return ProcessingLevelLabels[level] || level;
};

const LineageView: React.FC<LineageViewProps> = ({
  filteredData,
  collapsedLineages,
  expandedLevels,
  selectedFiles,
  onToggleLineage,
  onToggleLevel,
  onDeleteObservation,
  onDeleteLevel,
  onArchiveLevel,
  isArchivingLevel,
  onFileSelect,
  onView,
  onProcess,
}) => {
  const lineageEntries = Object.entries(groupByLineage(filteredData)).sort((a, b) => {
    if (a[0] === 'Manual Uploads') return 1;
    if (b[0] === 'Manual Uploads') return -1;
    const aFiles = Object.values(a[1]).flat();
    const bFiles = Object.values(b[1]).flat();
    const aMaxDate = Math.max(...aFiles.map((f) => new Date(f.uploadDate).getTime()));
    const bMaxDate = Math.max(...bFiles.map((f) => new Date(f.uploadDate).getTime()));
    return bMaxDate - aMaxDate;
  });

  return (
    <div className="lineage-view">
      {lineageEntries.map(([obsId, levels]) => {
        const isCollapsed = collapsedLineages.has(obsId);
        const totalFiles = Object.values(levels).flat().length;

        const allFiles = Object.values(levels).flat();
        const obsTitle = allFiles.find((f) => f.metadata?.mast_obs_title)?.metadata
          ?.mast_obs_title as string | undefined;
        const fileWithInfo = allFiles.find(
          (f) => f.imageInfo?.targetName || f.imageInfo?.instrument
        );
        const targetName = fileWithInfo?.imageInfo?.targetName;
        const instrument = fileWithInfo?.imageInfo?.instrument;
        const observationDate = allFiles.find((f) => f.imageInfo?.observationDate)?.imageInfo
          ?.observationDate;
        const mostRecentUpload = allFiles.reduce((latest, f) =>
          new Date(f.uploadDate) > new Date(latest.uploadDate) ? f : latest
        ).uploadDate;

        return (
          <div key={obsId} className={`lineage-group ${isCollapsed ? 'collapsed' : ''}`}>
            <div
              className="lineage-header"
              onClick={() => onToggleLineage(obsId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onToggleLineage(obsId)}
              aria-expanded={!isCollapsed}
            >
              <div className="lineage-header-left">
                <span className="collapse-icon">{isCollapsed ? '▶' : '▼'}</span>
                <div className="lineage-title">
                  <h3>{obsId}</h3>
                  <div className="lineage-meta">
                    {obsTitle && <span className="obs-title">{obsTitle}</span>}
                    {obsTitle && (targetName || instrument) && (
                      <span className="meta-separator">•</span>
                    )}
                    {targetName && <span className="target-name">{targetName}</span>}
                    {targetName && instrument && <span className="meta-separator">•</span>}
                    {instrument && <span className="instrument-name">{instrument}</span>}
                    {(obsTitle || targetName || instrument) && observationDate && (
                      <span className="meta-separator">•</span>
                    )}
                    {observationDate && (
                      <span className="observation-date">
                        Observed: {new Date(observationDate).toLocaleDateString()}
                      </span>
                    )}
                    {observationDate && <span className="meta-separator">•</span>}
                    <span className="download-date">
                      Downloaded: {new Date(mostRecentUpload).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
              <div className="lineage-header-right">
                <div className="level-badges">
                  {LEVEL_ORDER.map((level) => {
                    const count = levels[level]?.length || 0;
                    if (count === 0) return null;
                    return (
                      <span
                        key={level}
                        className="level-badge"
                        style={{ backgroundColor: getProcessingLevelColor(level) }}
                      >
                        {level}: {count}
                      </span>
                    );
                  })}
                </div>
                <span className="group-count">
                  {totalFiles} file{totalFiles !== 1 ? 's' : ''}
                </span>
                {obsId !== 'Manual Uploads' && (
                  <button
                    className="delete-observation-btn"
                    onClick={(e) => onDeleteObservation(obsId, e)}
                    title="Delete this observation"
                  >
                    <TrashIcon size={14} />
                    <span className="action-label">Delete</span>
                  </button>
                )}
              </div>
            </div>

            {!isCollapsed && (
              <div className="lineage-tree">
                {LEVEL_ORDER.map((level) => {
                  const filesAtLevel = levels[level];
                  if (!filesAtLevel || filesAtLevel.length === 0) return null;

                  const levelKey = `${obsId}-${level}`;
                  const isExpanded = expandedLevels.has(levelKey);
                  const levelTotalSize = filesAtLevel.reduce((sum, f) => sum + f.fileSize, 0);

                  return (
                    <div key={level} className="lineage-level">
                      <div
                        className="level-header"
                        onClick={() => onToggleLevel(levelKey)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="level-connector">
                          <span className="connector-line"></span>
                          <span
                            className="level-dot"
                            style={{ backgroundColor: getProcessingLevelColor(level) }}
                          ></span>
                        </div>
                        <span className="level-label">{getProcessingLevelLabel(level)}</span>
                        <span className="level-count">
                          ({filesAtLevel.length} files, {formatFileSize(levelTotalSize)})
                        </span>
                        <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
                        {obsId !== 'Manual Uploads' && (
                          <div className="level-actions">
                            <button
                              className="level-action-btn archive-btn"
                              onClick={(e) => onArchiveLevel(obsId, level, e)}
                              disabled={isArchivingLevel}
                              title={`Archive all ${level} files`}
                            >
                              <ArchiveIcon size={14} />
                              <span className="action-label">Archive</span>
                            </button>
                            <button
                              className="level-action-btn delete-btn"
                              onClick={(e) => onDeleteLevel(obsId, level, e)}
                              title={`Delete all ${level} files`}
                            >
                              <TrashIcon size={14} />
                              <span className="action-label">Delete</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="level-files">
                          {filesAtLevel.map((item) => (
                            <LineageFileCard
                              key={item.id}
                              item={item}
                              isSelected={selectedFiles.has(item.id)}
                              onFileSelect={onFileSelect}
                              onView={onView}
                              onProcess={onProcess}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {filteredData.length === 0 && (
        <div className="no-data">
          <h3>No data found</h3>
          <p>Upload some JWST data to get started!</p>
        </div>
      )}
    </div>
  );
};

export default LineageView;
