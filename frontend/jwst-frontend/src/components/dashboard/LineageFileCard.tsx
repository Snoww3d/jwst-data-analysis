import React from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { getFitsFileInfo } from '../../utils/fitsUtils';
import { getStatusColor } from '../../utils/statusUtils';
import { API_BASE_URL } from '../../config/api';
import { TelescopeIcon, ImageIcon, TableIcon, CheckIcon, PlusIcon } from '../icons/DashboardIcons';
import './LineageFileCard.css';

interface LineageFileCardProps {
  item: JwstDataModel;
  isSelected: boolean;
  onFileSelect: (dataId: string, event: React.MouseEvent) => void;
  onView: (item: JwstDataModel) => void;
  onProcess: (dataId: string, algorithm: string) => void;
  onArchive: (dataId: string, isArchived: boolean) => void;
}

const LineageFileCard: React.FC<LineageFileCardProps> = ({
  item,
  isSelected,
  onFileSelect,
  onView,
  onProcess,
  onArchive,
}) => {
  const fitsInfo = getFitsFileInfo(item.fileName);
  const canSelect = fitsInfo.viewable;

  return (
    <div className={`lineage-file-card ${isSelected ? 'selected-composite' : ''}`}>
      {fitsInfo.viewable && (
        <div className="lineage-thumbnail">
          {item.hasThumbnail ? (
            <img
              src={`${API_BASE_URL}/api/jwstdata/${item.id}/thumbnail`}
              loading="lazy"
              alt={item.fileName}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span className="lineage-thumbnail-placeholder">
              <TelescopeIcon size={24} />
            </span>
          )}
        </div>
      )}
      <div className="lineage-file-content">
        <div className="file-header">
          {fitsInfo.viewable && (
            <button
              className={`composite-select-btn small ${isSelected ? 'selected' : ''}`}
              onClick={(e) => onFileSelect(item.id, e)}
              disabled={!canSelect}
              title={isSelected ? 'Remove from analysis selection' : 'Select for analysis'}
            >
              {isSelected ? <CheckIcon /> : <PlusIcon />}
            </button>
          )}
          <span className="file-name" title={item.fileName}>
            {item.fileName}
          </span>
          <div className="file-badges">
            <span className={`fits-type-badge small ${fitsInfo.type}`} title={fitsInfo.description}>
              {fitsInfo.viewable ? <ImageIcon /> : <TableIcon />}
            </span>
            {item.imageInfo?.filter && (
              <span className="filter-badge small" title={`Filter: ${item.imageInfo.filter}`}>
                {item.imageInfo.filter}
              </span>
            )}
            <span
              className={`status ${item.processingStatus}`}
              style={{
                color: getStatusColor(item.processingStatus),
              }}
            >
              {item.processingStatus}
            </span>
          </div>
        </div>
        <div className="file-meta">
          <span>Type: {item.dataType}</span>
          <span>Size: {(item.fileSize / 1024 / 1024).toFixed(2)} MB</span>
          {item.imageInfo?.observationDate && (
            <span>Obs: {new Date(item.imageInfo.observationDate).toLocaleDateString()}</span>
          )}
          <span className="fits-type-label">{fitsInfo.label}</span>
        </div>
        <div className="file-actions">
          <button
            onClick={() => onView(item)}
            className={!fitsInfo.viewable ? 'disabled' : ''}
            disabled={!fitsInfo.viewable}
            title={fitsInfo.viewable ? 'View FITS image' : fitsInfo.description}
          >
            {fitsInfo.viewable ? 'View' : 'Table'}
          </button>
          <button onClick={() => onProcess(item.id, 'basic_analysis')}>Analyze</button>
          <button className="archive-btn" onClick={() => onArchive(item.id, item.isArchived)}>
            {item.isArchived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LineageFileCard;
