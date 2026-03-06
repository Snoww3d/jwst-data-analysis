import React from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { getFitsFileInfo, isSpectralFile } from '../../utils/fitsUtils';
import { getStatusColor } from '../../utils/statusUtils';
import { API_BASE_URL } from '../../config/api';
import { TelescopeIcon, ImageIcon, TableIcon, CheckIcon, PlusIcon } from '../icons/DashboardIcons';
import './LineageFileCard.css';

interface LineageFileCardProps {
  item: JwstDataModel;
  isSelected: boolean;
  isArchiving: boolean;
  onFileSelect: (dataId: string, event: React.MouseEvent) => void;
  onView: (item: JwstDataModel) => void;
  onArchive: (dataId: string, isArchived: boolean) => void;
}

const LineageFileCard: React.FC<LineageFileCardProps> = ({
  item,
  isSelected,
  isArchiving,
  onFileSelect,
  onView,
  onArchive,
}) => {
  const fitsInfo = getFitsFileInfo(item.fileName);
  const canSelect = fitsInfo.viewable;

  return (
    <div
      className={`lineage-file-card ${isSelected ? 'selected-composite' : ''} ${isArchiving ? 'archiving' : ''}`}
    >
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
              className={`btn-base composite-select-btn small ${isSelected ? 'selected' : ''}`}
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
            {(item.imageInfo?.instrument || item.sensorInfo?.instrument) &&
              (() => {
                const inst = item.imageInfo?.instrument || item.sensorInfo?.instrument || '';
                const group = inst.includes('/') ? inst.substring(0, inst.indexOf('/')) : inst;
                return (
                  <span
                    className={`instrument-badge small ${group.toLowerCase()}`}
                    title={`Instrument: ${inst}`}
                  >
                    {inst}
                  </span>
                );
              })()}
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
            className={`btn-base view-file-btn ${!fitsInfo.viewable && fitsInfo.type !== 'table' ? 'disabled' : ''}`}
            disabled={!fitsInfo.viewable && fitsInfo.type !== 'table'}
            title={
              isSpectralFile(item.fileName)
                ? 'View spectrum'
                : fitsInfo.viewable
                  ? 'View FITS image'
                  : fitsInfo.type === 'table'
                    ? 'View table data'
                    : fitsInfo.description
            }
          >
            {isSpectralFile(item.fileName) ? 'Spectrum' : fitsInfo.viewable ? 'View' : 'Table'}
          </button>
          <button
            className="btn-base archive-btn"
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
    </div>
  );
};

export default LineageFileCard;
