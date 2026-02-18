import React from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { getFitsFileInfo } from '../../utils/fitsUtils';
import { getStatusColor } from '../../utils/statusUtils';
import { API_BASE_URL } from '../../config/api';
import { TelescopeIcon, ImageIcon, TableIcon, CheckIcon, PlusIcon } from '../icons/DashboardIcons';
import './DataCard.css';

interface DataCardProps {
  item: JwstDataModel;
  isSelected: boolean;
  isArchiving: boolean;
  selectedTag: string;
  onFileSelect: (dataId: string, event: React.MouseEvent) => void;
  onView: (item: JwstDataModel) => void;
  onProcess: (dataId: string, algorithm: string) => void;
  onArchive: (dataId: string, isArchived: boolean) => void;
  onTagClick: (tag: string) => void;
}

const DataCard: React.FC<DataCardProps> = ({
  item,
  isSelected,
  isArchiving,
  selectedTag,
  onFileSelect,
  onView,
  onProcess,
  onArchive,
  onTagClick,
}) => {
  const fitsInfo = getFitsFileInfo(item.fileName);
  const canSelect = fitsInfo.viewable;

  return (
    <div
      className={`data-card ${isSelected ? 'selected-composite' : ''} ${isArchiving ? 'archiving' : ''}`}
    >
      {fitsInfo.viewable && (
        <div className="card-thumbnail">
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
            <div className="thumbnail-placeholder">
              <TelescopeIcon size={32} />
            </div>
          )}
        </div>
      )}
      <div className="card-header">
        {fitsInfo.viewable && (
          <button
            className={`composite-select-btn ${isSelected ? 'selected' : ''}`}
            onClick={(e) => onFileSelect(item.id, e)}
            disabled={!canSelect}
            title={isSelected ? 'Remove from analysis selection' : 'Select for analysis'}
          >
            {isSelected ? <CheckIcon /> : <PlusIcon />}
          </button>
        )}
        <h4>{item.fileName}</h4>
        <div className="card-badges">
          <span className={`fits-type-badge ${fitsInfo.type}`} title={fitsInfo.description}>
            {fitsInfo.viewable ? <ImageIcon /> : <TableIcon />} {fitsInfo.label}
          </span>
          {item.imageInfo?.filter && (
            <span className="filter-badge" title={`Filter: ${item.imageInfo.filter}`}>
              {item.imageInfo.filter}
            </span>
          )}
          <span
            className={`status ${item.processingStatus}`}
            style={{ color: getStatusColor(item.processingStatus) }}
          >
            {item.processingStatus}
          </span>
        </div>
      </div>
      <div className="card-content">
        <p>
          <strong>Type:</strong> {item.dataType}
        </p>
        <p>
          <strong>Size:</strong> {(item.fileSize / 1024 / 1024).toFixed(2)} MB
        </p>
        {item.imageInfo?.observationDate && (
          <p>
            <strong>Observed:</strong>{' '}
            {new Date(item.imageInfo.observationDate).toLocaleDateString()}
          </p>
        )}
        <p>
          <strong>Downloaded:</strong> {new Date(item.uploadDate).toLocaleDateString()}
        </p>
        {item.description && (
          <p>
            <strong>Description:</strong> {item.description}
          </p>
        )}
        {item.tags.length > 0 && (
          <div className="tags">
            {item.tags.map((tag, index) => (
              <button
                key={index}
                className={`tag ${selectedTag === tag.toLowerCase() ? 'active' : ''}`}
                type="button"
                title={`Filter by tag: ${tag}`}
                onClick={() => onTagClick(tag.toLowerCase())}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="card-actions">
        <button
          onClick={() => onView(item)}
          className={`view-file-btn ${!fitsInfo.viewable ? 'disabled' : ''}`}
          disabled={!fitsInfo.viewable}
          title={fitsInfo.viewable ? 'View FITS image' : fitsInfo.description}
        >
          {fitsInfo.viewable ? 'View' : 'Table'}
        </button>
        <button onClick={() => onProcess(item.id, 'basic_analysis')}>Analyze</button>
        <button onClick={() => onProcess(item.id, 'image_enhancement')}>Enhance</button>
        <button
          className="archive-btn"
          onClick={() => onArchive(item.id, item.isArchived)}
          disabled={isArchiving}
        >
          {isArchiving
            ? item.isArchived
              ? 'Unarchiving...'
              : 'Archiving...'
            : item.isArchived
              ? 'Unarchive'
              : 'Archive'}
        </button>
      </div>
    </div>
  );
};

export default DataCard;
