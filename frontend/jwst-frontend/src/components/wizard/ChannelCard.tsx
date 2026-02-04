import React from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { getFilterLabel } from '../../utils/wavelengthUtils';
import StretchControls, { StretchParams } from '../StretchControls';
import './ChannelCard.css';

type ChannelType = 'red' | 'green' | 'blue';

interface ChannelCardProps {
  channel: ChannelType;
  data: JwstDataModel | null;
  availableImages: JwstDataModel[];
  stretchParams: StretchParams;
  onImageChange: (dataId: string) => void;
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
 */
export const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  data,
  availableImages,
  stretchParams,
  onImageChange,
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
      </div>

      <div className="channel-content">
        {/* Image selector dropdown */}
        <div className="channel-image-select">
          <label className="select-label">Image</label>
          <select
            value={data?.id || ''}
            onChange={(e) => onImageChange(e.target.value)}
            className="image-select"
          >
            <option value="" disabled>
              Select image...
            </option>
            {availableImages.map((img) => (
              <option key={img.id} value={img.id}>
                {img.fileName} - {getFilterLabel(img)}
              </option>
            ))}
          </select>
        </div>

        {/* Thumbnail preview */}
        {previewUrl && (
          <div className="channel-thumbnail">
            <img src={previewUrl} alt={`${channel} channel preview`} />
          </div>
        )}

        {/* Selected image info */}
        {data && (
          <div className="channel-info">
            <span className="info-label">Filter:</span>
            <span className="info-value">{getFilterLabel(data)}</span>
            {data.imageInfo?.instrument && (
              <>
                <span className="info-label">Instrument:</span>
                <span className="info-value">{data.imageInfo.instrument}</span>
              </>
            )}
          </div>
        )}

        {/* Embedded stretch controls */}
        {data && (
          <div className="channel-stretch">
            <StretchControls params={stretchParams} onChange={onStretchChange} collapsed={false} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelCard;
