import React from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { getFilterLabel, getWavelengthFromData } from '../../utils/wavelengthUtils';
import './ImageSelectionStep.css';

interface ImageSelectionStepProps {
  allImages: JwstDataModel[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

/**
 * Step 1: Select 3 images for the RGB composite
 */
export const ImageSelectionStep: React.FC<ImageSelectionStepProps> = ({
  allImages,
  selectedIds,
  onSelectionChange,
}) => {
  // Filter to only show image-type files (not tables/catalogs)
  const imageFiles = allImages.filter(
    (img) =>
      img.dataType?.toLowerCase() === 'image' || img.fileName?.match(/_(cal|i2d|rate|s2d)\.fits?$/i)
  );

  const handleImageClick = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else if (newSelection.size < 3) {
      newSelection.add(id);
    }
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    // Select first 3 images
    const first3 = imageFiles.slice(0, 3).map((img) => img.id);
    onSelectionChange(new Set(first3));
  };

  const handleClearAll = () => {
    onSelectionChange(new Set());
  };

  return (
    <div className="image-selection-step">
      <div className="step-instructions">
        <h3>Select 3 Images</h3>
        <p>
          Choose 3 FITS images to combine into an RGB composite. Images will be automatically sorted
          by wavelength (shortest to Blue, middle to Green, longest to Red).
        </p>
        <div className="selection-actions">
          <button className="btn-action" onClick={handleSelectAll} disabled={imageFiles.length < 3}>
            Select First 3
          </button>
          <button
            className="btn-action btn-secondary"
            onClick={handleClearAll}
            disabled={selectedIds.size === 0}
          >
            Clear Selection
          </button>
          <span className="selection-count">{selectedIds.size} / 3 selected</span>
        </div>
      </div>

      <div className="image-grid">
        {imageFiles.length === 0 ? (
          <div className="no-images">
            <p>No image files available.</p>
            <p className="hint">Import FITS images from MAST or upload local files first.</p>
          </div>
        ) : (
          imageFiles.map((img) => {
            const isSelected = selectedIds.has(img.id);
            const wavelength = getWavelengthFromData(img);
            const canSelect = selectedIds.size < 3 || isSelected;

            return (
              <button
                key={img.id}
                className={`image-card ${isSelected ? 'selected' : ''} ${
                  !canSelect ? 'disabled' : ''
                }`}
                onClick={() => canSelect && handleImageClick(img.id)}
                disabled={!canSelect}
                type="button"
              >
                <div className="image-card-content">
                  <div className="image-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                    </svg>
                  </div>
                  <div className="image-details">
                    <span className="image-name" title={img.fileName}>
                      {img.fileName}
                    </span>
                    <span className="image-filter">{getFilterLabel(img)}</span>
                    {wavelength && (
                      <span className="image-wavelength">{wavelength.toFixed(2)} μm</span>
                    )}
                    {img.imageInfo?.instrument && (
                      <span className="image-instrument">{img.imageInfo.instrument}</span>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <div className="selection-badge">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ImageSelectionStep;
