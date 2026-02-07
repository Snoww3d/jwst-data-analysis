import React, { useEffect, useRef, useState } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import {
  ChannelAssignment,
  ChannelParams,
  DEFAULT_CHANNEL_PARAMS,
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get individual channel thumbnails
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const getImageById = (id: string | null): JwstDataModel | null => {
    if (!id) return null;
    return selectedImages.find((img) => img.id === id) || null;
  };

  // Auto-sort on initial load
  useEffect(() => {
    if (selectedImages.length === 3 && !channelAssignment.red) {
      const sorted = autoSortByWavelength(selectedImages);
      onChannelAssignmentChange(sorted);

      // Initialize params for each image
      const newParams: ChannelParams = {};
      selectedImages.forEach((img) => {
        newParams[img.id] = { ...DEFAULT_CHANNEL_PARAMS };
      });
      onChannelParamsChange(newParams);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImages]);

  // Debounced preview generation
  useEffect(() => {
    const { red, green, blue } = channelAssignment;
    if (!red || !green || !blue) return;

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
    if (!red || !green || !blue) return;

    setPreviewLoading(true);
    setPreviewError(null);

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      const redParams = channelParams[red] || DEFAULT_CHANNEL_PARAMS;
      const greenParams = channelParams[green] || DEFAULT_CHANNEL_PARAMS;
      const blueParams = channelParams[blue] || DEFAULT_CHANNEL_PARAMS;

      const blob = await compositeService.generatePreview(
        { dataId: red, ...redParams },
        { dataId: green, ...greenParams },
        { dataId: blue, ...blueParams },
        600,
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

  const handleChannelImageChange = (channel: 'red' | 'green' | 'blue', dataId: string) => {
    onChannelAssignmentChange({
      ...channelAssignment,
      [channel]: dataId,
    });
  };

  const handleChannelStretchChange = (dataId: string, params: StretchParams) => {
    onChannelParamsChange({
      ...channelParams,
      [dataId]: params,
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
            const dataId = channelAssignment[channel];
            const data = getImageById(dataId);
            const params = dataId
              ? channelParams[dataId] || DEFAULT_CHANNEL_PARAMS
              : DEFAULT_CHANNEL_PARAMS;

            return (
              <ChannelCard
                key={channel}
                channel={channel}
                data={data}
                availableImages={selectedImages}
                stretchParams={params}
                onImageChange={(id) => handleChannelImageChange(channel, id)}
                onStretchChange={(p) => dataId && handleChannelStretchChange(dataId, p)}
                previewUrl={dataId ? thumbnails[dataId] : undefined}
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
          {channelAssignment.red && channelAssignment.green && channelAssignment.blue && (
            <div className="preview-legend">
              <div className="legend-item red">
                <span className="legend-color" />
                <span className="legend-label">
                  {getFilterLabel(getImageById(channelAssignment.red) ?? ({} as JwstDataModel))}
                </span>
              </div>
              <div className="legend-item green">
                <span className="legend-color" />
                <span className="legend-label">
                  {getFilterLabel(getImageById(channelAssignment.green) ?? ({} as JwstDataModel))}
                </span>
              </div>
              <div className="legend-item blue">
                <span className="legend-color" />
                <span className="legend-label">
                  {getFilterLabel(getImageById(channelAssignment.blue) ?? ({} as JwstDataModel))}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChannelAssignmentStep;
