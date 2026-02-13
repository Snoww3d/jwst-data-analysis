import React, { useState, useMemo, useCallback } from 'react';
import { JwstDataModel } from '../types/JwstDataTypes';
import { API_BASE_URL } from '../config/api';
import './ComparisonImagePicker.css';

export interface ImageSelection {
  dataId: string;
  title: string;
  metadata?: Record<string, unknown>;
}

interface ComparisonImagePickerProps {
  allImages: JwstDataModel[];
  initialImageA?: ImageSelection;
  onSelect: (imageA: ImageSelection, imageB: ImageSelection) => void;
  onClose: () => void;
}

function getImageMeta(item: JwstDataModel): string {
  const parts: string[] = [];
  const instrument = item.metadata?.mast_instrument_name;
  const filter = item.metadata?.mast_filters;
  const target = item.metadata?.mast_target_name;
  if (target) parts.push(String(target));
  if (instrument) parts.push(String(instrument));
  if (filter) parts.push(String(filter));
  return parts.join(' / ') || item.dataType || '';
}

function getThumbnailUrl(dataId: string): string {
  return `${API_BASE_URL}/api/jwstdata/${dataId}/preview?cmap=grayscale&width=96&height=96`;
}

const ComparisonImagePicker: React.FC<ComparisonImagePickerProps> = ({
  allImages,
  initialImageA,
  onSelect,
  onClose,
}) => {
  const [selectedA, setSelectedA] = useState<string | null>(initialImageA?.dataId ?? null);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');

  const filterImages = useCallback(
    (search: string) => {
      if (!search.trim()) return allImages;
      const lower = search.toLowerCase();
      return allImages.filter(
        (item) =>
          item.fileName.toLowerCase().includes(lower) ||
          getImageMeta(item).toLowerCase().includes(lower)
      );
    },
    [allImages]
  );

  const filteredA = useMemo(() => filterImages(searchA), [filterImages, searchA]);
  const filteredB = useMemo(() => filterImages(searchB), [filterImages, searchB]);

  const canCompare = selectedA !== null && selectedB !== null && selectedA !== selectedB;

  const handleCompare = () => {
    if (!canCompare) return;
    const itemA = allImages.find((i) => i.id === selectedA);
    const itemB = allImages.find((i) => i.id === selectedB);
    if (!itemA || !itemB) return;

    onSelect(
      { dataId: itemA.id, title: itemA.fileName, metadata: itemA.metadata },
      { dataId: itemB.id, title: itemB.fileName, metadata: itemB.metadata }
    );
  };

  const renderColumn = (
    label: string,
    selectedId: string | null,
    onItemSelect: (id: string) => void,
    otherId: string | null,
    search: string,
    onSearchChange: (val: string) => void,
    filtered: JwstDataModel[]
  ) => {
    const selectedItem = selectedId ? allImages.find((i) => i.id === selectedId) : null;
    return (
      <div className="comparison-picker-column">
        <div className="comparison-picker-column-header">
          <h3>{label}</h3>
          {selectedItem && (
            <span className="comparison-picker-selected-label">
              {selectedItem.fileName.length > 25
                ? selectedItem.fileName.slice(0, 22) + '...'
                : selectedItem.fileName}
            </span>
          )}
        </div>
        <input
          type="text"
          className="comparison-picker-search"
          placeholder="Search images..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <div className="comparison-picker-list">
          {filtered.map((item) => {
            const isSelected = item.id === selectedId;
            const isDisabled = item.id === otherId;
            return (
              <div
                key={item.id}
                className={`comparison-picker-item${isSelected ? ' selected' : ''}${isDisabled ? ' disabled' : ''}`}
                onClick={() => {
                  if (!isDisabled) onItemSelect(item.id);
                }}
              >
                <img
                  className="comparison-picker-item-thumb"
                  src={getThumbnailUrl(item.id)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <div className="comparison-picker-item-info">
                  <div className="comparison-picker-item-name" title={item.fileName}>
                    {item.fileName}
                  </div>
                  <div className="comparison-picker-item-meta">{getImageMeta(item)}</div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div
              style={{ color: '#666', fontSize: '0.8rem', padding: '16px', textAlign: 'center' }}
            >
              No matching images
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="comparison-picker-overlay" onClick={onClose}>
      <div className="comparison-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="comparison-picker-header">
          <h2>Select Images to Compare</h2>
          <button className="comparison-picker-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="comparison-picker-body">
          {renderColumn(
            'Image A',
            selectedA,
            setSelectedA,
            selectedB,
            searchA,
            setSearchA,
            filteredA
          )}
          <div className="comparison-picker-divider" />
          {renderColumn(
            'Image B',
            selectedB,
            setSelectedB,
            selectedA,
            searchB,
            setSearchB,
            filteredB
          )}
        </div>

        <div className="comparison-picker-footer">
          <button className="comparison-picker-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="comparison-picker-btn primary"
            disabled={!canCompare}
            onClick={handleCompare}
            title={canCompare ? 'Open comparison viewer' : 'Select two different images to compare'}
          >
            Compare
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComparisonImagePicker;
