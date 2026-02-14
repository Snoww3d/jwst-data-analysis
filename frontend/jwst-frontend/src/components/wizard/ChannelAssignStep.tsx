import React, { useState, useCallback } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { ChannelAssignment, ChannelName } from '../../types/CompositeTypes';
import { autoSortByWavelength, getFilterLabel } from '../../utils/wavelengthUtils';
import { API_BASE_URL } from '../../config/api';
import { TelescopeIcon } from '../icons/DashboardIcons';
import './ChannelAssignStep.css';

interface ChannelAssignStepProps {
  allImages: JwstDataModel[];
  channelAssignment: ChannelAssignment;
  onChannelAssignmentChange: (assignment: ChannelAssignment) => void;
}

type DragSource = 'pool' | ChannelName;

interface DragData {
  imageId: string;
  source: DragSource;
}

const CHANNEL_COLORS: Record<ChannelName, string> = {
  red: '#ff4444',
  green: '#44ff44',
  blue: '#4488ff',
};

const CHANNEL_LABELS: Record<ChannelName, string> = {
  red: 'Red Channel',
  green: 'Green Channel',
  blue: 'Blue Channel',
};

/**
 * Step 1: Assign images to R/G/B channels via drag-and-drop with thumbnails
 */
export const ChannelAssignStep: React.FC<ChannelAssignStepProps> = ({
  allImages,
  channelAssignment,
  onChannelAssignmentChange,
}) => {
  const [dragOverTarget, setDragOverTarget] = useState<DragSource | null>(null);

  // Filter to only show image-type files
  const imageFiles = allImages.filter(
    (img) =>
      img.dataType?.toLowerCase() === 'image' || img.fileName?.match(/_(cal|i2d|rate|s2d)\.fits?$/i)
  );

  // Build set of assigned image IDs
  const assignedIds = new Set([
    ...channelAssignment.red,
    ...channelAssignment.green,
    ...channelAssignment.blue,
  ]);

  // Pool = images not assigned to any channel
  const poolImagesUnsorted = imageFiles.filter((img) => !assignedIds.has(img.id));

  // Determine the active target from assigned images so we can prioritize matching pool images
  const getImageTarget = (img: JwstDataModel): string | undefined =>
    img.observationBaseId || img.imageInfo?.targetName;

  const assignedImages = imageFiles.filter((img) => assignedIds.has(img.id));
  const activeTarget = assignedImages.length > 0 ? getImageTarget(assignedImages[0]) : undefined;

  const isMatchingTarget = (img: JwstDataModel): boolean => {
    if (!activeTarget) return true; // No target yet — everything matches
    return getImageTarget(img) === activeTarget;
  };

  // Sort: matching target first, non-matching after
  const poolImages = [...poolImagesUnsorted].sort((a, b) => {
    const aMatch = isMatchingTarget(a);
    const bMatch = isMatchingTarget(b);
    if (aMatch === bMatch) return 0;
    return aMatch ? -1 : 1;
  });

  const handleDragStart = useCallback((e: React.DragEvent, imageId: string, source: DragSource) => {
    const data: DragData = { imageId, source };
    e.dataTransfer.setData('application/json', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, target: DragSource) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(target);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the drop zone (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverTarget(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, target: DragSource) => {
      e.preventDefault();
      setDragOverTarget(null);

      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;

      let data: DragData;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }

      const { imageId, source } = data;
      if (source === target) return; // No-op if same zone

      const newAssignment = { ...channelAssignment };

      // Remove from source channel
      if (source !== 'pool') {
        newAssignment[source] = newAssignment[source].filter((id) => id !== imageId);
      }

      // Add to target channel (not pool — pool is just "unassigned")
      if (target !== 'pool') {
        if (!newAssignment[target].includes(imageId)) {
          newAssignment[target] = [...newAssignment[target], imageId];
        }
      }

      onChannelAssignmentChange(newAssignment);
    },
    [channelAssignment, onChannelAssignmentChange]
  );

  const handleAutoSort = () => {
    if (imageFiles.length < 3) return;
    try {
      const sorted = autoSortByWavelength(imageFiles);
      onChannelAssignmentChange(sorted);
    } catch {
      // Silently ignore if sort fails
    }
  };

  const handleClearAll = () => {
    onChannelAssignmentChange({ red: [], green: [], blue: [] });
  };

  const getImagesForChannel = (channel: ChannelName): JwstDataModel[] => {
    return channelAssignment[channel]
      .map((id) => imageFiles.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);
  };

  const renderImageCard = (img: JwstDataModel, source: DragSource, dimmed = false) => {
    const targetName = img.imageInfo?.targetName;

    return (
      <div
        key={img.id}
        className={`dnd-image-card${dimmed ? ' dimmed' : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(e, img.id, source)}
      >
        <div className="dnd-card-thumbnail">
          {img.hasThumbnail ? (
            <img
              src={`${API_BASE_URL}/api/jwstdata/${img.id}/thumbnail`}
              alt={img.fileName}
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const placeholder = (e.target as HTMLImageElement).nextElementSibling;
                if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
              }}
            />
          ) : null}
          <div
            className="dnd-card-thumbnail-fallback"
            style={{ display: img.hasThumbnail ? 'none' : 'flex' }}
          >
            <TelescopeIcon size={24} />
          </div>
        </div>
        <div className="dnd-card-info">
          {targetName && (
            <span className="dnd-card-target" title={targetName}>
              {targetName}
            </span>
          )}
          <span className="dnd-card-filter">{getFilterLabel(img)}</span>
        </div>
        <div className="dnd-card-grip">
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" opacity="0.4">
            <circle cx="2" cy="2" r="1.5" />
            <circle cx="6" cy="2" r="1.5" />
            <circle cx="2" cy="7" r="1.5" />
            <circle cx="6" cy="7" r="1.5" />
            <circle cx="2" cy="12" r="1.5" />
            <circle cx="6" cy="12" r="1.5" />
          </svg>
        </div>
      </div>
    );
  };

  return (
    <div className="channel-assign-step">
      <div className="step-header">
        <div className="step-instructions">
          <h3>Assign Channels</h3>
          <p>Drag images into R/G/B channels. Drag back to the pool to unassign.</p>
        </div>
        <div className="step-actions">
          <button
            className="btn-action"
            onClick={handleAutoSort}
            disabled={imageFiles.length < 3}
            type="button"
          >
            Auto-Sort by Wavelength
          </button>
          <button
            className="btn-action btn-secondary"
            onClick={handleClearAll}
            disabled={assignedIds.size === 0}
            type="button"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="assign-body">
        {/* Channel Drop Lanes — always visible */}
        <div className="channel-lanes">
          {(['red', 'green', 'blue'] as const).map((channel) => {
            const images = getImagesForChannel(channel);
            const color = CHANNEL_COLORS[channel];
            const isDragOver = dragOverTarget === channel;

            return (
              <div
                key={channel}
                className={`channel-lane ${isDragOver ? 'drag-over' : ''}`}
                style={{ '--lane-color': color } as React.CSSProperties}
                onDragOver={(e) => handleDragOver(e, channel)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, channel)}
              >
                <div className="lane-header">
                  <span className="lane-indicator" />
                  <span className="lane-label">{CHANNEL_LABELS[channel]}</span>
                  <span className="lane-count">
                    {images.length} image{images.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="lane-cards">
                  {images.length > 0 ? (
                    images.map((img) => renderImageCard(img, channel))
                  ) : (
                    <div className="lane-empty">Drop images here</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Available Images Pool — scrolls independently */}
        <div
          className={`image-pool ${dragOverTarget === 'pool' ? 'drag-over' : ''}`}
          onDragOver={(e) => handleDragOver(e, 'pool')}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, 'pool')}
        >
          <div className="pool-header">
            <span className="pool-label">Available Images</span>
            <span className="pool-count">{poolImages.length} available</span>
          </div>
          <div className="pool-cards">
            {poolImages.length > 0 ? (
              poolImages.map((img) => renderImageCard(img, 'pool', !isMatchingTarget(img)))
            ) : (
              <div className="pool-empty">
                {imageFiles.length === 0
                  ? 'No image files in this group'
                  : 'All images assigned to channels'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChannelAssignStep;
