import React, { useState, useCallback } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { NChannelState, createDefaultNChannel } from '../../types/CompositeTypes';
import {
  autoAssignNChannels,
  getFilterLabel,
  channelColorToHex,
  hexToRgb,
  rgbToHue,
} from '../../utils/wavelengthUtils';
import { API_BASE_URL } from '../../config/api';
import { TelescopeIcon } from '../icons/DashboardIcons';
import './ChannelAssignStep.css';

interface ChannelAssignStepProps {
  allImages: JwstDataModel[];
  channels: NChannelState[];
  onChannelsChange: (channels: NChannelState[]) => void;
}

type DragSource = 'pool' | string; // 'pool' or channel ID

interface DragData {
  imageId: string;
  source: DragSource;
}

/**
 * Step 1: Assign images to N dynamic channels via drag-and-drop with thumbnails and color pickers
 */
export const ChannelAssignStep: React.FC<ChannelAssignStepProps> = ({
  allImages,
  channels,
  onChannelsChange,
}) => {
  const [dragOverTarget, setDragOverTarget] = useState<DragSource | null>(null);
  const [reorderDragOver, setReorderDragOver] = useState<string | null>(null);

  // Filter to only show image-type files
  const imageFiles = allImages.filter(
    (img) =>
      img.dataType?.toLowerCase() === 'image' || img.fileName?.match(/_(cal|i2d|rate|s2d)\.fits?$/i)
  );

  // Build set of assigned image IDs across all channels
  const assignedIds = new Set(channels.flatMap((ch) => ch.dataIds));

  // Pool = images not assigned to any channel
  const poolImagesUnsorted = imageFiles.filter((img) => !assignedIds.has(img.id));

  // Determine the active target from assigned images so we can prioritize matching pool images
  const getImageTarget = (img: JwstDataModel): string | undefined =>
    img.observationBaseId || img.imageInfo?.targetName;

  const assignedImages = imageFiles.filter((img) => assignedIds.has(img.id));
  const activeTarget = assignedImages.length > 0 ? getImageTarget(assignedImages[0]) : undefined;

  const isMatchingTarget = (img: JwstDataModel): boolean => {
    if (!activeTarget) return true;
    return getImageTarget(img) === activeTarget;
  };

  // Pre-compute target counts for sorting
  const targetCounts = new Map<string | undefined, number>();
  for (const img of poolImagesUnsorted) {
    const t = getImageTarget(img);
    targetCounts.set(t, (targetCounts.get(t) || 0) + 1);
  }

  // Sort pool images: active target first, then by group size
  const poolImages = [...poolImagesUnsorted].sort((a, b) => {
    const aTarget = getImageTarget(a);
    const bTarget = getImageTarget(b);

    if (activeTarget) {
      const aMatch = aTarget === activeTarget;
      const bMatch = bTarget === activeTarget;
      if (aMatch !== bMatch) return aMatch ? -1 : 1;
    }

    if (aTarget !== bTarget) {
      const aCount = targetCounts.get(aTarget) || 0;
      const bCount = targetCounts.get(bTarget) || 0;
      if (aCount !== bCount) return bCount - aCount;
      return (aTarget || '').localeCompare(bTarget || '');
    }
    return 0;
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
      if (source === target) return;

      const newChannels = channels.map((ch) => {
        // Remove from source channel
        if (ch.id === source) {
          return { ...ch, dataIds: ch.dataIds.filter((id) => id !== imageId) };
        }
        // Add to target channel
        if (ch.id === target) {
          if (!ch.dataIds.includes(imageId)) {
            return { ...ch, dataIds: [...ch.dataIds, imageId] };
          }
        }
        return ch;
      });

      onChannelsChange(newChannels);
    },
    [channels, onChannelsChange]
  );

  // Channel lane reorder via drag-and-drop (uses separate MIME type to avoid conflicts)
  const handleLaneDragStart = useCallback((e: React.DragEvent, channelId: string) => {
    e.dataTransfer.setData('text/channel-reorder', channelId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleLaneDragOver = useCallback((e: React.DragEvent, channelId: string) => {
    // Only accept channel reorder drags (not image drags)
    if (e.dataTransfer.types.includes('text/channel-reorder')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setReorderDragOver(channelId);
    }
  }, []);

  const handleLaneDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setReorderDragOver(null);
    }
  }, []);

  const handleLaneDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      const sourceId = e.dataTransfer.getData('text/channel-reorder');
      if (!sourceId || sourceId === targetId) {
        setReorderDragOver(null);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setReorderDragOver(null);

      const sourceIdx = channels.findIndex((ch) => ch.id === sourceId);
      const targetIdx = channels.findIndex((ch) => ch.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1) return;

      const newChannels = [...channels];
      const [moved] = newChannels.splice(sourceIdx, 1);
      newChannels.splice(targetIdx, 0, moved);
      onChannelsChange(newChannels);
    },
    [channels, onChannelsChange]
  );

  // Auto-sort: find images for best target, create N channels by filter
  const autoSortTarget = (() => {
    if (activeTarget) return activeTarget;
    let best: string | undefined;
    let maxCount = 0;
    for (const [t, count] of targetCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        best = t;
      }
    }
    return best;
  })();

  const autoSortImages = autoSortTarget
    ? imageFiles.filter((img) => getImageTarget(img) === autoSortTarget)
    : imageFiles;

  const handleAutoSort = () => {
    if (autoSortImages.length < 2) return;
    try {
      const sorted = autoAssignNChannels(autoSortImages);
      onChannelsChange(sorted);
    } catch {
      // Silently ignore if sort fails
    }
  };

  const handleClearAll = () => {
    onChannelsChange(channels.map((ch) => ({ ...ch, dataIds: [] })));
  };

  const handleAddChannel = () => {
    // Pick a hue evenly spaced from existing channels (derive hue from RGB if needed)
    const existingHues = channels.map((ch) => {
      if (ch.color.hue !== undefined) return ch.color.hue;
      if (ch.color.rgb) return rgbToHue(ch.color.rgb[0], ch.color.rgb[1], ch.color.rgb[2]);
      return 0;
    });
    let newHue = 0;
    if (existingHues.length > 0) {
      // Find the largest gap in the hue circle
      const sorted = [...existingHues].sort((a, b) => a - b);
      let maxGap = 0;
      let gapStart = 0;
      for (let i = 0; i < sorted.length; i++) {
        const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360;
        const gap = next - sorted[i];
        if (gap > maxGap) {
          maxGap = gap;
          gapStart = sorted[i];
        }
      }
      newHue = (gapStart + maxGap / 2) % 360;
    }
    onChannelsChange([...channels, createDefaultNChannel(newHue)]);
  };

  const handleRemoveChannel = (channelId: string) => {
    if (channels.length <= 1) return;
    onChannelsChange(channels.filter((ch) => ch.id !== channelId));
  };

  const handleColorChange = (channelId: string, hexColor: string) => {
    const rgb = hexToRgb(hexColor);
    onChannelsChange(channels.map((ch) => (ch.id === channelId ? { ...ch, color: { rgb } } : ch)));
  };

  const handleLabelChange = (channelId: string, label: string) => {
    onChannelsChange(channels.map((ch) => (ch.id === channelId ? { ...ch, label } : ch)));
  };

  const getImagesForChannel = (channel: NChannelState): JwstDataModel[] => {
    return channel.dataIds
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
          <p>Drag images into channels. Click the color swatch to change a channel&apos;s color.</p>
        </div>
        <div className="step-actions">
          <button
            className="btn-action"
            onClick={handleAutoSort}
            disabled={autoSortImages.length < 2}
            type="button"
            title={
              autoSortTarget
                ? `Auto-assign ${autoSortImages.length} images from ${autoSortTarget} by filter`
                : 'Auto-assign all images by filter'
            }
          >
            Auto-Assign by Filter
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
        {/* Channel Drop Lanes — dynamic N channels */}
        <div className="channel-lanes">
          {channels.map((channel) => {
            const images = getImagesForChannel(channel);
            const color = channelColorToHex(channel.color);
            const isDragOver = dragOverTarget === channel.id;

            return (
              <div
                key={channel.id}
                className={`channel-lane ${isDragOver ? 'drag-over' : ''}${reorderDragOver === channel.id ? ' reorder-drag-over' : ''}`}
                style={{ '--lane-color': color } as React.CSSProperties}
                onDragOver={(e) => {
                  handleDragOver(e, channel.id);
                  handleLaneDragOver(e, channel.id);
                }}
                onDragLeave={(e) => {
                  handleDragLeave(e);
                  handleLaneDragLeave(e);
                }}
                onDrop={(e) => {
                  if (e.dataTransfer.types.includes('text/channel-reorder')) {
                    handleLaneDrop(e, channel.id);
                  } else {
                    handleDrop(e, channel.id);
                  }
                }}
              >
                <div
                  className="lane-header"
                  draggable
                  onDragStart={(e) => handleLaneDragStart(e, channel.id)}
                >
                  <span className="lane-grip" title="Drag to reorder">
                    <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor" opacity="0.3">
                      <circle cx="1.5" cy="1.5" r="1" />
                      <circle cx="4.5" cy="1.5" r="1" />
                      <circle cx="1.5" cy="5" r="1" />
                      <circle cx="4.5" cy="5" r="1" />
                      <circle cx="1.5" cy="8.5" r="1" />
                      <circle cx="4.5" cy="8.5" r="1" />
                    </svg>
                  </span>
                  <label className="lane-color-picker" title="Change channel color">
                    <span className="lane-indicator" />
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => handleColorChange(channel.id, e.target.value)}
                      className="lane-color-input"
                    />
                  </label>
                  <input
                    type="text"
                    className="lane-label-input"
                    value={channel.label || ''}
                    placeholder="Channel"
                    onChange={(e) => handleLabelChange(channel.id, e.target.value)}
                  />
                  <span className="lane-count">
                    {images.length} image{images.length !== 1 ? 's' : ''}
                  </span>
                  {channels.length > 1 && (
                    <button
                      className="lane-remove-btn"
                      onClick={() => handleRemoveChannel(channel.id)}
                      title="Remove channel"
                      type="button"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="lane-cards">
                  {images.length > 0 ? (
                    images.map((img) => renderImageCard(img, channel.id))
                  ) : (
                    <div className="lane-empty">Drop images here</div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add Channel button */}
          <button className="add-channel-btn" onClick={handleAddChannel} type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            Add Channel
          </button>
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
