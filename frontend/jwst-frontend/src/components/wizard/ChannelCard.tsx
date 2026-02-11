import React from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { getFilterLabel } from '../../utils/wavelengthUtils';
import StretchControls, { StretchParams } from '../StretchControls';
import './ChannelCard.css';

type ChannelType = 'red' | 'green' | 'blue';

interface ChannelCardProps {
  channel: ChannelType;
  assignedImages: JwstDataModel[];
  unassignedImages: JwstDataModel[];
  stretchParams: StretchParams;
  onAddImage: (dataId: string) => void;
  onRemoveImage: (dataId: string) => void;
  onStretchChange: (params: StretchParams) => void;
  previewUrl?: string;
}

const CHANNEL_COLORS: Record<ChannelType, string> = {
  red: '#ff4444',
  green: '#44ff44',
  blue: '#4488ff',
};

const CHANNEL_LABELS: Record<ChannelType, string> = {
  red: 'Red Channel',
  green: 'Green Channel',
  blue: 'Blue Channel',
};

/**
 * Card component for configuring a single color channel (R, G, or B)
 * Supports multiple images per channel displayed as removable chips.
 */
export const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  assignedImages,
  unassignedImages,
  stretchParams,
  onAddImage,
  onRemoveImage,
  onStretchChange,
  previewUrl,
}) => {
  const color = CHANNEL_COLORS[channel];
  const label = CHANNEL_LABELS[channel];

  return (
    <div className="channel-card" style={{ '--channel-color': color } as React.CSSProperties}>
      <div className="channel-header">
        <div className="channel-indicator" />
        <h4 className="channel-title">{label}</h4>
        <span className="channel-count">
          {assignedImages.length} image{assignedImages.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="channel-content">
        {/* Assigned image chips */}
        {assignedImages.length > 0 && (
          <div className="channel-image-chips">
            {assignedImages.map((img) => (
              <div key={img.id} className="image-chip">
                <span className="image-chip-label" title={img.fileName}>
                  {getFilterLabel(img)}
                </span>
                <button
                  className="image-chip-remove"
                  onClick={() => onRemoveImage(img.id)}
                  aria-label={`Remove ${img.fileName}`}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add image dropdown */}
        {unassignedImages.length > 0 && (
          <div className="channel-add-image">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) onAddImage(e.target.value);
              }}
              className="image-select"
            >
              <option value="" disabled>
                + Add image...
              </option>
              {unassignedImages.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.fileName} - {getFilterLabel(img)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Thumbnail preview */}
        {previewUrl && (
          <div className="channel-thumbnail">
            <img src={previewUrl} alt={`${channel} channel preview`} />
          </div>
        )}

        {/* Selected image info */}
        {assignedImages.length === 1 && (
          <div className="channel-info">
            <span className="info-label">Filter:</span>
            <span className="info-value">{getFilterLabel(assignedImages[0])}</span>
            {assignedImages[0].imageInfo?.instrument && (
              <>
                <span className="info-label">Instrument:</span>
                <span className="info-value">{assignedImages[0].imageInfo.instrument}</span>
              </>
            )}
          </div>
        )}

        {/* Embedded stretch controls */}
        {assignedImages.length > 0 && (
          <div className="channel-stretch">
            <StretchControls params={stretchParams} onChange={onStretchChange} collapsed={false} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelCard;
