import React from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import DataCard from './DataCard';
import './TargetGroupView.css';

interface TargetGroupViewProps {
  filteredData: JwstDataModel[];
  collapsedGroups: Set<string>;
  selectedFiles: Set<string>;
  selectedTag: string;
  onToggleGroup: (groupId: string) => void;
  onFileSelect: (dataId: string, event: React.MouseEvent) => void;
  onView: (item: JwstDataModel) => void;
  onProcess: (dataId: string, algorithm: string) => void;
  onArchive: (dataId: string, isArchived: boolean) => void;
  onTagClick: (tag: string) => void;
}

const TargetGroupView: React.FC<TargetGroupViewProps> = ({
  filteredData,
  collapsedGroups,
  selectedFiles,
  selectedTag,
  onToggleGroup,
  onFileSelect,
  onView,
  onProcess,
  onArchive,
  onTagClick,
}) => {
  const groupedEntries = Object.entries(
    filteredData.reduce(
      (groups, item) => {
        const target = item.imageInfo?.targetName || 'Unknown Target';
        if (!groups[target]) groups[target] = [];
        groups[target].push(item);
        return groups;
      },
      {} as Record<string, JwstDataModel[]>
    )
  ).sort((a, b) => {
    if (a[0] === 'Unknown Target') return 1;
    if (b[0] === 'Unknown Target') return -1;
    return a[0].localeCompare(b[0]);
  });

  return (
    <div className="grouped-view">
      {groupedEntries.map(([groupId, items]) => {
        const instruments = [...new Set(items.map((f) => f.imageInfo?.instrument).filter(Boolean))];
        const filters = [...new Set(items.map((f) => f.imageInfo?.filter).filter(Boolean))];

        return (
          <div
            key={groupId}
            className={`data-group ${collapsedGroups.has(groupId) ? 'collapsed' : ''}`}
          >
            <div
              className="group-header"
              onClick={() => onToggleGroup(groupId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onToggleGroup(groupId)}
              aria-expanded={!collapsedGroups.has(groupId)}
            >
              <div className="group-header-left">
                <span className="collapse-icon">{collapsedGroups.has(groupId) ? '▶' : '▼'}</span>
                <div className="group-title">
                  <h3>{groupId}</h3>
                  <div className="group-meta">
                    {instruments.length > 0 && (
                      <span className="instrument-list">{instruments.join(', ')}</span>
                    )}
                    {instruments.length > 0 && filters.length > 0 && (
                      <span className="meta-separator">•</span>
                    )}
                    {filters.length > 0 && (
                      <span className="filter-list">
                        {filters.slice(0, 5).join(', ')}
                        {filters.length > 5 ? '...' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <span className="group-count">
                {items.length} file{items.length !== 1 ? 's' : ''}
              </span>
            </div>
            {!collapsedGroups.has(groupId) && (
              <div className="data-grid">
                {items.map((item) => (
                  <DataCard
                    key={item.id}
                    item={item}
                    isSelected={selectedFiles.has(item.id)}
                    selectedTag={selectedTag}
                    onFileSelect={onFileSelect}
                    onView={onView}
                    onProcess={onProcess}
                    onArchive={onArchive}
                    onTagClick={onTagClick}
                  />
                ))}
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

export default TargetGroupView;
