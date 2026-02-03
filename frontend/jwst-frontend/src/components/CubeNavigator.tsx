import React, { useCallback, useEffect, useRef } from 'react';
import './CubeNavigator.css';
import { CubeInfoResponse } from '../types/JwstDataTypes';
import { formatSliceDisplay } from '../utils/cubeUtils';

interface CubeNavigatorProps {
  cubeInfo: CubeInfoResponse;
  currentSlice: number;
  onSliceChange: (slice: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
  playbackSpeed: number;
  onPlaybackSpeedChange: (speed: number) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

// Playback speed options in FPS
const PLAYBACK_SPEEDS = [
  { value: 1, label: '1 FPS' },
  { value: 2, label: '2 FPS' },
  { value: 5, label: '5 FPS' },
  { value: 10, label: '10 FPS' },
];

// SVG Icons
const Icons = {
  Layers: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
      <polyline points="2 17 12 22 22 17"></polyline>
      <polyline points="2 12 12 17 22 12"></polyline>
    </svg>
  ),
  Play: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg>
  ),
  Pause: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <rect x="6" y="4" width="4" height="16"></rect>
      <rect x="14" y="4" width="4" height="16"></rect>
    </svg>
  ),
  ChevronLeft: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
  ),
  ChevronRight: () => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  ),
  ChevronDown: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  ),
  ChevronUp: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="18 15 12 9 6 15"></polyline>
    </svg>
  ),
  SkipBack: () => (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="19 20 9 12 19 4 19 20"></polygon>
      <line x1="5" y1="19" x2="5" y2="5"></line>
    </svg>
  ),
  SkipForward: () => (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="5 4 15 12 5 20 5 4"></polygon>
      <line x1="19" y1="5" x2="19" y2="19"></line>
    </svg>
  ),
};

const CubeNavigator: React.FC<CubeNavigatorProps> = ({
  cubeInfo,
  currentSlice,
  onSliceChange,
  isPlaying,
  onPlayPause,
  playbackSpeed,
  onPlaybackSpeedChange,
  collapsed = false,
  onToggleCollapse,
}) => {
  const sliderRef = useRef<HTMLInputElement>(null);

  const { n_slices, axis3, slice_unit, slice_label } = cubeInfo;
  const maxSlice = n_slices - 1;

  // Format the current slice display
  const sliceDisplay = formatSliceDisplay(currentSlice, n_slices, axis3, slice_unit, slice_label);

  // Navigation handlers
  const handlePrevSlice = useCallback(() => {
    const newSlice = currentSlice > 0 ? currentSlice - 1 : maxSlice;
    onSliceChange(newSlice);
  }, [currentSlice, maxSlice, onSliceChange]);

  const handleNextSlice = useCallback(() => {
    const newSlice = currentSlice < maxSlice ? currentSlice + 1 : 0;
    onSliceChange(newSlice);
  }, [currentSlice, maxSlice, onSliceChange]);

  const handleFirstSlice = useCallback(() => {
    onSliceChange(0);
  }, [onSliceChange]);

  const handleLastSlice = useCallback(() => {
    onSliceChange(maxSlice);
  }, [maxSlice, onSliceChange]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onSliceChange(parseInt(e.target.value, 10));
    },
    [onSliceChange]
  );

  // Keyboard shortcuts (handled at parent level, but we can add local hints)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Prevent slider from consuming arrow keys when focused
      if (e.key === 'ArrowLeft' || e.key === ',') {
        e.preventDefault();
        handlePrevSlice();
      } else if (e.key === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        handleNextSlice();
      } else if (e.key === ' ') {
        e.preventDefault();
        onPlayPause();
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleFirstSlice();
      } else if (e.key === 'End') {
        e.preventDefault();
        handleLastSlice();
      }
    },
    [handlePrevSlice, handleNextSlice, onPlayPause, handleFirstSlice, handleLastSlice]
  );

  // Update slider fill based on current value
  useEffect(() => {
    if (sliderRef.current) {
      const percentage = (currentSlice / maxSlice) * 100;
      sliderRef.current.style.setProperty('--slider-fill', `${percentage}%`);
    }
  }, [currentSlice, maxSlice]);

  return (
    <div
      className={`cube-navigator ${collapsed ? 'collapsed' : ''}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="cube-navigator-header" onClick={onToggleCollapse}>
        <div className="cube-header-left">
          <Icons.Layers />
          <span className="cube-title">Cube Navigator</span>
        </div>
        <div className="cube-header-right">
          <span className="cube-slice-badge">{n_slices} slices</span>
          {onToggleCollapse && (
            <span className="collapse-icon">
              {collapsed ? <Icons.ChevronDown /> : <Icons.ChevronUp />}
            </span>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="cube-navigator-body">
          {/* Slice display */}
          <div className="slice-display">
            <span className="slice-info">{sliceDisplay}</span>
          </div>

          {/* Slider */}
          <div className="slider-container">
            <input
              ref={sliderRef}
              type="range"
              min="0"
              max={maxSlice}
              value={currentSlice}
              onChange={handleSliderChange}
              className="cube-slider"
              aria-label="Slice selector"
            />
          </div>

          {/* Controls */}
          <div className="cube-controls">
            <div className="nav-buttons">
              <button
                className="cube-btn cube-btn-small"
                onClick={handleFirstSlice}
                title="First slice (Home)"
                aria-label="First slice"
              >
                <Icons.SkipBack />
              </button>
              <button
                className="cube-btn"
                onClick={handlePrevSlice}
                title="Previous slice (← or ,)"
                aria-label="Previous slice"
              >
                <Icons.ChevronLeft />
              </button>
              <button
                className={`cube-btn cube-btn-play ${isPlaying ? 'playing' : ''}`}
                onClick={onPlayPause}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Icons.Pause /> : <Icons.Play />}
              </button>
              <button
                className="cube-btn"
                onClick={handleNextSlice}
                title="Next slice (→ or .)"
                aria-label="Next slice"
              >
                <Icons.ChevronRight />
              </button>
              <button
                className="cube-btn cube-btn-small"
                onClick={handleLastSlice}
                title="Last slice (End)"
                aria-label="Last slice"
              >
                <Icons.SkipForward />
              </button>
            </div>

            <div className="speed-control">
              <label className="speed-label">Speed:</label>
              <select
                value={playbackSpeed}
                onChange={(e) => onPlaybackSpeedChange(parseInt(e.target.value, 10))}
                className="speed-select"
                aria-label="Playback speed"
              >
                {PLAYBACK_SPEEDS.map((speed) => (
                  <option key={speed.value} value={speed.value}>
                    {speed.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Keyboard shortcuts hint */}
          <div className="keyboard-hints">
            <span className="hint">← → navigate</span>
            <span className="hint-sep">|</span>
            <span className="hint">Space play/pause</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CubeNavigator;
