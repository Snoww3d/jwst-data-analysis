import React, { useEffect, useRef, useState } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import {
  ChannelAssignment,
  ChannelName,
  ChannelParams,
  DEFAULT_CHANNEL_PARAMS,
  DEFAULT_CHANNEL_PARAMS_BY_CHANNEL,
} from '../../types/CompositeTypes';
import { StretchParams } from '../StretchControls';
import { autoSortByWavelength, getFilterLabel } from '../../utils/wavelengthUtils';
import { compositeService } from '../../services';
import ChannelCard from './ChannelCard';
import './ChannelAssignmentStep.css';

interface ChannelAssignmentStepProps {
  selectedImages: JwstDataModel[];
  channelAssignment: ChannelAssignment;
  channelParams: ChannelParams;
  onChannelAssignmentChange: (assignment: ChannelAssignment) => void;
  onChannelParamsChange: (params: ChannelParams) => void;
}

/**
 * Step 2: Assign images to R/G/B channels and configure stretch parameters
 */
export const ChannelAssignmentStep: React.FC<ChannelAssignmentStepProps> = ({
  selectedImages,
  channelAssignment,
  channelParams,
  onChannelAssignmentChange,
  onChannelParamsChange,
}) => {
  const createDefaultChannelParams = (): ChannelParams => ({
    red: { ...DEFAULT_CHANNEL_PARAMS_BY_CHANNEL.red },
    green: { ...DEFAULT_CHANNEL_PARAMS_BY_CHANNEL.green },
    blue: { ...DEFAULT_CHANNEL_PARAMS_BY_CHANNEL.blue },
  });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get individual channel thumbnails
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const getImagesForChannel = (channel: ChannelName): JwstDataModel[] => {
    return channelAssignment[channel]
      .map((id) => selectedImages.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);
  };

  // Images not assigned to any channel
  const assignedIds = new Set([
    ...channelAssignment.red,
    ...channelAssignment.green,
    ...channelAssignment.blue,
  ]);
  const unassignedImages = selectedImages.filter((img) => !assignedIds.has(img.id));

  // Auto-sort on initial load
  useEffect(() => {
    if (selectedImages.length >= 3 && channelAssignment.red.length === 0) {
      const sorted = autoSortByWavelength(selectedImages);
      onChannelAssignmentChange(sorted);

      onChannelParamsChange(createDefaultChannelParams());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImages]);

  // Debounced preview generation
  useEffect(() => {
    const { red, green, blue } = channelAssignment;
    if (red.length === 0 || green.length === 0 || blue.length === 0) return;

    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Debounce for 500ms
    debounceTimerRef.current = setTimeout(() => {
      generatePreview();
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelAssignment, channelParams]);

  // Load individual thumbnails
  useEffect(() => {
    selectedImages.forEach(async (img) => {
      if (!thumbnails[img.id]) {
        try {
          const response = await fetch(
            `/api/jwstdata/${img.id}/preview?width=150&height=150&stretch=zscale&cmap=grayscale`
          );
          if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            setThumbnails((prev) => ({ ...prev, [img.id]: url }));
          }
        } catch {
          // Silently fail for thumbnails
        }
      }
    });

    return () => {
      // Cleanup thumbnail URLs
      Object.values(thumbnails).forEach(URL.revokeObjectURL);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImages]);

  const generatePreview = async () => {
    const { red, green, blue } = channelAssignment;
    if (red.length === 0 || green.length === 0 || blue.length === 0) return;

    setPreviewLoading(true);
    setPreviewError(null);

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      const redParams = channelParams.red || DEFAULT_CHANNEL_PARAMS;
      const greenParams = channelParams.green || DEFAULT_CHANNEL_PARAMS;
      const blueParams = channelParams.blue || DEFAULT_CHANNEL_PARAMS;

      const blob = await compositeService.generatePreview(
        { dataIds: red, ...redParams },
        { dataIds: green, ...greenParams },
        { dataIds: blue, ...blueParams },
        600,
        undefined,
        abortControllerRef.current.signal
      );

      // Cleanup old URL
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setPreviewError('Failed to generate preview');
        console.error('Preview generation error:', err);
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleAddImageToChannel = (channel: 'red' | 'green' | 'blue', dataId: string) => {
    onChannelAssignmentChange({
      ...channelAssignment,
      [channel]: [...channelAssignment[channel], dataId],
    });
  };

  const handleRemoveImageFromChannel = (channel: 'red' | 'green' | 'blue', dataId: string) => {
    onChannelAssignmentChange({
      ...channelAssignment,
      [channel]: channelAssignment[channel].filter((id) => id !== dataId),
    });
  };

  const handleChannelStretchChange = (channel: ChannelName, params: StretchParams) => {
    onChannelParamsChange({
      ...channelParams,
      [channel]: params,
    });
  };

  const handleAutoSort = () => {
    const sorted = autoSortByWavelength(selectedImages);
    onChannelAssignmentChange(sorted);
  };

  const handleSwapChannels = (
    channel1: 'red' | 'green' | 'blue',
    channel2: 'red' | 'green' | 'blue'
  ) => {
    onChannelAssignmentChange({
      ...channelAssignment,
      [channel1]: channelAssignment[channel2],
      [channel2]: channelAssignment[channel1],
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="channel-assignment-step">
      <div className="step-header">
        <div className="step-instructions">
          <h3>Assign Channels</h3>
          <p>
            Assign images to color channels and adjust stretch parameters. The preview updates
            automatically.
          </p>
        </div>
        <div className="step-actions">
          <button className="btn-action" onClick={handleAutoSort} type="button">
            Auto-Sort by Wavelength
          </button>
          <button
            className="btn-action btn-secondary"
            onClick={() => handleSwapChannels('red', 'blue')}
            type="button"
          >
            Swap R/B
          </button>
        </div>
      </div>

      <div className="assignment-content">
        <div className="channels-grid">
          {(['red', 'green', 'blue'] as const).map((channel) => {
            const images = getImagesForChannel(channel);
            const params = channelParams[channel] || DEFAULT_CHANNEL_PARAMS;
            const firstId = channelAssignment[channel][0];

            return (
              <ChannelCard
                key={channel}
                channel={channel}
                assignedImages={images}
                unassignedImages={unassignedImages}
                stretchParams={params}
                onAddImage={(id) => handleAddImageToChannel(channel, id)}
                onRemoveImage={(id) => handleRemoveImageFromChannel(channel, id)}
                onStretchChange={(p) => handleChannelStretchChange(channel, p)}
                previewUrl={firstId ? thumbnails[firstId] : undefined}
              />
            );
          })}
        </div>

        <div className="preview-panel">
          <h4 className="preview-title">Live Preview</h4>
          <div className="preview-container">
            {previewLoading && (
              <div className="preview-loading">
                <div className="spinner" />
                <span>Generating preview...</span>
              </div>
            )}
            {previewError && !previewLoading && (
              <div className="preview-error">
                <span>{previewError}</span>
                <button className="btn-retry" onClick={generatePreview}>
                  Retry
                </button>
              </div>
            )}
            {previewUrl && !previewLoading && (
              <img src={previewUrl} alt="Composite preview" className="preview-image" />
            )}
            {!previewUrl && !previewLoading && !previewError && (
              <div className="preview-placeholder">
                <span>Select all channels to see preview</span>
              </div>
            )}
          </div>
          {channelAssignment.red.length > 0 &&
            channelAssignment.green.length > 0 &&
            channelAssignment.blue.length > 0 && (
              <div className="preview-legend">
                {(['red', 'green', 'blue'] as const).map((ch) => {
                  const images = getImagesForChannel(ch);
                  const legendText =
                    images.length <= 2
                      ? images.map((img) => getFilterLabel(img)).join(', ')
                      : `${images.length} filters`;
                  return (
                    <div key={ch} className={`legend-item ${ch}`}>
                      <span className="legend-color" />
                      <span className="legend-label">{legendText}</span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default ChannelAssignmentStep;
