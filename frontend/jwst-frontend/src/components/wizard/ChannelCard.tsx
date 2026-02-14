import React from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { getFilterLabel } from '../../utils/wavelengthUtils';
import StretchControls, { StretchParams } from '../StretchControls';
import './ChannelCard.css';

type ChannelType = 'red' | 'green' | 'blue';

interface ChannelCardProps {
  channel: ChannelType;
  assignedImages: JwstDataModel[];
  stretchParams: StretchParams;
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
 * Shows assigned images summary, thumbnail preview, and stretch controls.
 */
export const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  assignedImages,
  stretchParams,
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

        {/* Multi-image summary */}
        {assignedImages.length > 1 && (
          <div className="channel-info">
            <span className="info-label">Filters:</span>
            <span className="info-value">
              {assignedImages.map((img) => getFilterLabel(img)).join(', ')}
            </span>
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
