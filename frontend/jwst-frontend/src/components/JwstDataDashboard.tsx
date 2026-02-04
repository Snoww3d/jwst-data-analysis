import React, { useState } from 'react';
import {
  JwstDataModel,
  ProcessingLevelLabels,
  ProcessingLevelColors,
  DeleteObservationResponse,
  DeleteLevelResponse,
} from '../types/JwstDataTypes';
import MastSearch from './MastSearch';
import WhatsNewPanel from './WhatsNewPanel';
import ImageViewer from './ImageViewer';
import CompositeWizard from './CompositeWizard';
import { getFitsFileInfo } from '../utils/fitsUtils';
import { jwstDataService, ApiError } from '../services';
import './JwstDataDashboard.css';

interface JwstDataDashboardProps {
  data: JwstDataModel[];
  onDataUpdate: () => void;
}

const JwstDataDashboard: React.FC<JwstDataDashboardProps> = ({ data, onDataUpdate }) => {
  const [selectedDataType, setSelectedDataType] = useState<string>('all');
  const [selectedProcessingLevel, setSelectedProcessingLevel] = useState<string>('all');
  const [selectedViewability, setSelectedViewability] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [viewMode, setViewMode] = useState<'lineage' | 'target'>('lineage');
  const [showUploadForm, setShowUploadForm] = useState<boolean>(false);
  const [showMastSearch, setShowMastSearch] = useState<boolean>(false);
  const [showWhatsNew, setShowWhatsNew] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [viewingImageId, setViewingImageId] = useState<string | null>(null);
  const [viewingImageTitle, setViewingImageTitle] = useState<string>('');
  const [viewingImageMetadata, setViewingImageMetadata] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedLineages, setCollapsedLineages] = useState<Set<string>>(new Set());
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set());
  const [deleteModalData, setDeleteModalData] = useState<DeleteObservationResponse | null>(null);
  const [deleteLevelModalData, setDeleteLevelModalData] = useState<DeleteLevelResponse | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isArchivingLevel, setIsArchivingLevel] = useState<boolean>(false);
  const [isSyncingMast, setIsSyncingMast] = useState<boolean>(false);
  const [selectedForComposite, setSelectedForComposite] = useState<Set<string>>(new Set());
  const [showCompositeWizard, setShowCompositeWizard] = useState<boolean>(false);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const toggleLineageCollapse = (obsId: string) => {
    setCollapsedLineages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(obsId)) {
        newSet.delete(obsId);
      } else {
        newSet.add(obsId);
      }
      return newSet;
    });
  };

  const toggleLevelExpand = (key: string) => {
    setExpandedLevels((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const groupByLineage = (items: JwstDataModel[]) => {
    const lineageGroups: Record<string, Record<string, JwstDataModel[]>> = {};

    items.forEach((item) => {
      const obsId = item.observationBaseId || item.metadata?.mast_obs_id || 'Manual Uploads';
      const level = item.processingLevel || 'unknown';

      if (!lineageGroups[obsId]) {
        lineageGroups[obsId] = {};
      }
      if (!lineageGroups[obsId][level]) {
        lineageGroups[obsId][level] = [];
      }
      lineageGroups[obsId][level].push(item);
    });

    return lineageGroups;
  };

  const getProcessingLevelColor = (level: string) => {
    return ProcessingLevelColors[level] || ProcessingLevelColors['unknown'];
  };

  const getProcessingLevelLabel = (level: string) => {
    return ProcessingLevelLabels[level] || level;
  };

  const filteredData = data.filter((item) => {
    const matchesType = selectedDataType === 'all' || item.dataType === selectedDataType;
    const matchesLevel =
      selectedProcessingLevel === 'all' || item.processingLevel === selectedProcessingLevel;
    const matchesSearch =
      item.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.tags.some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesArchived = showArchived ? item.isArchived : !item.isArchived;
    // Viewability check: use backend isViewable if available, fallback to frontend fitsUtils
    const itemViewable =
      item.isViewable !== undefined ? item.isViewable : getFitsFileInfo(item.fileName).viewable;
    const matchesViewability =
      selectedViewability === 'all' ||
      (selectedViewability === 'viewable' && itemViewable) ||
      (selectedViewability === 'table' && !itemViewable);
    return matchesType && matchesLevel && matchesSearch && matchesArchived && matchesViewability;
  });

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Get form data
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem('file-upload') as HTMLInputElement;
    const dataTypeSelect = form.elements.namedItem('data-type-select') as HTMLSelectElement;
    const descriptionInput = form.querySelector('textarea') as HTMLTextAreaElement;
    // Tags is the first text input in the form
    const tagsInput = form.querySelectorAll('input[type="text"]')[0] as HTMLInputElement;

    if (!fileInput.files || fileInput.files.length === 0) {
      alert('Please select a file');
      return;
    }

    const file = fileInput.files[0];
    const description = descriptionInput.value || undefined;

    // Parse tags (comma separated)
    const tags = tagsInput.value
      ? tagsInput.value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t)
      : undefined;

    try {
      await jwstDataService.upload(file, dataTypeSelect.value, description, tags);
      alert('File uploaded successfully!');
      setShowUploadForm(false);
      onDataUpdate(); // Refresh the list
    } catch (error) {
      console.error('Error uploading file:', error);
      if (ApiError.isApiError(error)) {
        alert(`Upload failed: ${error.message}`);
      } else {
        alert('Error uploading file');
      }
    }
  };

  const handleProcessData = async (dataId: string, algorithm: string) => {
    try {
      await jwstDataService.process(dataId, algorithm);
      alert('Processing started successfully!');
      onDataUpdate();
    } catch (error) {
      console.error('Error processing data:', error);
      if (ApiError.isApiError(error)) {
        alert(`Failed to start processing: ${error.message}`);
      } else {
        alert('Error processing data');
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'green';
      case 'processing':
        return 'orange';
      case 'failed':
        return 'red';
      default:
        return 'gray';
    }
  };

  const handleArchive = async (dataId: string, isCurrentlyArchived: boolean) => {
    try {
      if (isCurrentlyArchived) {
        await jwstDataService.unarchive(dataId);
      } else {
        await jwstDataService.archive(dataId);
      }
      onDataUpdate();
    } catch (error) {
      console.error(`Error ${isCurrentlyArchived ? 'unarchiving' : 'archiving'} data:`, error);
      const action = isCurrentlyArchived ? 'unarchive' : 'archive';
      if (ApiError.isApiError(error)) {
        alert(`Failed to ${action} file: ${error.message}`);
      } else {
        alert('Error updating archive status');
      }
    }
  };

  const handleSyncMast = async () => {
    setIsSyncingMast(true);
    try {
      const result = await jwstDataService.scanAndImportMastFiles();
      alert(
        result.message ||
          `Sync complete: ${result.importedCount} files imported, ${result.skippedCount} skipped`
      );
      onDataUpdate();
    } catch (error) {
      console.error('Error syncing MAST files:', error);
      if (ApiError.isApiError(error)) {
        alert(`Failed to sync: ${error.message}`);
      } else {
        alert('Error syncing MAST files');
      }
    } finally {
      setIsSyncingMast(false);
    }
  };

  const handleDeleteObservationClick = async (
    observationBaseId: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation(); // Prevent toggling collapse

    try {
      // Fetch preview data
      const previewData = await jwstDataService.getDeletePreview(observationBaseId);
      setDeleteModalData(previewData);
    } catch (error) {
      console.error('Error fetching delete preview:', error);
      if (ApiError.isApiError(error)) {
        alert(`Failed to get observation info: ${error.message}`);
      } else {
        alert('Error fetching observation info');
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalData) return;

    setIsDeleting(true);
    try {
      const result = await jwstDataService.deleteObservation(deleteModalData.observationBaseId);
      alert(result.message);
      setDeleteModalData(null);
      onDataUpdate();
    } catch (error) {
      console.error('Error deleting observation:', error);
      if (ApiError.isApiError(error)) {
        alert(`Failed to delete observation: ${error.message}`);
      } else {
        alert('Error deleting observation');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteLevelClick = async (
    observationBaseId: string,
    processingLevel: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation(); // Prevent toggling level expand

    try {
      // Fetch preview data
      const previewData = await jwstDataService.getDeleteLevelPreview(
        observationBaseId,
        processingLevel
      );
      setDeleteLevelModalData(previewData);
    } catch (error) {
      console.error('Error fetching delete level preview:', error);
      if (ApiError.isApiError(error)) {
        alert(`Failed to get level info: ${error.message}`);
      } else {
        alert('Error fetching level info');
      }
    }
  };

  const handleConfirmDeleteLevel = async () => {
    if (!deleteLevelModalData) return;

    setIsDeleting(true);
    try {
      const result = await jwstDataService.deleteObservationLevel(
        deleteLevelModalData.observationBaseId,
        deleteLevelModalData.processingLevel
      );
      alert(result.message);
      setDeleteLevelModalData(null);
      onDataUpdate();
    } catch (error) {
      console.error('Error deleting level:', error);
      if (ApiError.isApiError(error)) {
        alert(`Failed to delete level: ${error.message}`);
      } else {
        alert('Error deleting level');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchiveLevelClick = async (
    observationBaseId: string,
    processingLevel: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation(); // Prevent toggling level expand

    if (!window.confirm(`Archive all ${processingLevel} files for this observation?`)) {
      return;
    }

    setIsArchivingLevel(true);
    try {
      const result = await jwstDataService.archiveObservationLevel(
        observationBaseId,
        processingLevel
      );
      alert(result.message);
      onDataUpdate();
    } catch (error) {
      console.error('Error archiving level:', error);
      if (ApiError.isApiError(error)) {
        alert(`Failed to archive level: ${error.message}`);
      } else {
        alert('Error archiving level');
      }
    } finally {
      setIsArchivingLevel(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} bytes`;
  };

  const handleCompositeSelect = (dataId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedForComposite((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dataId)) {
        newSet.delete(dataId);
      } else if (newSet.size < 3) {
        newSet.add(dataId);
      }
      return newSet;
    });
  };

  const handleOpenCompositeWizard = () => {
    setShowCompositeWizard(true);
  };

  const handleCloseCompositeWizard = () => {
    setShowCompositeWizard(false);
    setSelectedForComposite(new Set()); // Clear selection when wizard closes
  };

  // Get only viewable images for composite selection
  const viewableImages = data.filter((item) => {
    const fitsInfo = getFitsFileInfo(item.fileName);
    return fitsInfo.viewable && !item.isArchived;
  });

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="controls">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search files, descriptions, or tags..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-box">
            <label htmlFor="data-type-filter" className="visually-hidden">
              Filter by Data Type
            </label>
            <select
              id="data-type-filter"
              value={selectedDataType}
              onChange={(e) => setSelectedDataType(e.target.value)}
            >
              <option value="all">All Types</option>
              <option value="image">Images</option>
              <option value="sensor">Sensor Data</option>
              <option value="spectral">Spectral Data</option>
              <option value="metadata">Metadata</option>
              <option value="calibration">Calibration</option>
              <option value="raw">Raw Data</option>
              <option value="processed">Processed Data</option>
            </select>
          </div>
          <div className="filter-box">
            <label htmlFor="processing-level-filter" className="visually-hidden">
              Filter by Processing Level
            </label>
            <select
              id="processing-level-filter"
              value={selectedProcessingLevel}
              onChange={(e) => setSelectedProcessingLevel(e.target.value)}
            >
              <option value="all">All Levels</option>
              <option value="L1">Level 1 (Raw)</option>
              <option value="L2a">Level 2a (Rate)</option>
              <option value="L2b">Level 2b (Calibrated)</option>
              <option value="L3">Level 3 (Combined)</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div className="filter-box">
            <label htmlFor="viewability-filter" className="visually-hidden">
              Filter by File Type
            </label>
            <select
              id="viewability-filter"
              value={selectedViewability}
              onChange={(e) => setSelectedViewability(e.target.value)}
            >
              <option value="all">All Files</option>
              <option value="viewable">Viewable (Images)</option>
              <option value="table">Non-Viewable (Tables)</option>
            </select>
          </div>
          <button className="upload-btn" onClick={() => setShowUploadForm(true)}>
            Upload Data
          </button>
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'lineage' ? 'active' : ''}`}
              onClick={() => setViewMode('lineage')}
              title="Lineage Tree View"
            >
              <span className="icon">⌲</span> Lineage
            </button>
            <button
              className={`view-btn ${viewMode === 'target' ? 'active' : ''}`}
              onClick={() => setViewMode('target')}
              title="Group by Target Name"
            >
              <span className="icon">🎯</span> By Target
            </button>
          </div>
          <button
            className={`mast-search-btn ${showMastSearch ? 'active' : ''}`}
            onClick={() => setShowMastSearch(!showMastSearch)}
          >
            {showMastSearch ? 'Hide MAST Search' : 'Search MAST'}
          </button>
          <button
            className={`whats-new-btn ${showWhatsNew ? 'active' : ''}`}
            onClick={() => setShowWhatsNew(!showWhatsNew)}
          >
            {showWhatsNew ? "Hide What's New" : "What's New"}
          </button>
          <button
            className={`archived-toggle ${showArchived ? 'active' : ''}`}
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? 'Show Active' : 'Show Archived'}
          </button>
          <button
            className="import-mast-btn"
            onClick={handleSyncMast}
            disabled={isSyncingMast}
            title="Scan disk for MAST files, import new ones, and refresh metadata for existing ones"
          >
            {isSyncingMast ? 'Syncing...' : 'Sync MAST Files'}
          </button>
          <button
            className={`composite-btn ${selectedForComposite.size === 3 ? 'ready' : ''}`}
            onClick={handleOpenCompositeWizard}
            disabled={selectedForComposite.size !== 3}
            title={
              selectedForComposite.size === 3
                ? 'Create RGB composite from selected images'
                : `Select 3 images for RGB composite (${selectedForComposite.size}/3 selected)`
            }
          >
            <span className="composite-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="8" cy="8" r="4" fill="#ff4444" opacity="0.8" />
                <circle cx="16" cy="8" r="4" fill="#44ff44" opacity="0.8" />
                <circle cx="12" cy="14" r="4" fill="#4488ff" opacity="0.8" />
              </svg>
            </span>
            RGB Composite ({selectedForComposite.size}/3)
          </button>
        </div>
      </div>

      {showMastSearch && <MastSearch onImportComplete={onDataUpdate} />}

      {showWhatsNew && <WhatsNewPanel onImportComplete={onDataUpdate} />}

      {showUploadForm && (
        <div className="upload-modal">
          <div className="upload-content">
            <h3>Upload JWST Data</h3>
            <form onSubmit={handleUpload}>
              <div className="form-group">
                <label htmlFor="file-upload">File:</label>
                <input
                  id="file-upload"
                  type="file"
                  accept=".fits,.fits.gz,.jpg,.png,.tiff,.csv,.json"
                  required
                  title="Select a file to upload"
                />
              </div>
              <div className="form-group">
                <label htmlFor="data-type-select">Data Type:</label>
                <select id="data-type-select" required title="Select the data type">
                  <option value="">Select type</option>
                  <option value="image">Image</option>
                  <option value="sensor">Sensor Data</option>
                  <option value="spectral">Spectral Data</option>
                  <option value="metadata">Metadata</option>
                </select>
              </div>
              <div className="form-group">
                <label>Description:</label>
                <textarea placeholder="Optional description"></textarea>
              </div>
              <div className="form-group">
                <label>Tags:</label>
                <input type="text" placeholder="Comma-separated tags" />
              </div>
              <div className="form-actions">
                <button type="submit">Upload</button>
                <button type="button" onClick={() => setShowUploadForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="data-content">
        {viewMode === 'target' ? (
          <div className="grouped-view">
            {Object.entries(
              filteredData.reduce(
                (groups, item) => {
                  const target = item.imageInfo?.targetName || 'Unknown Target';
                  if (!groups[target]) groups[target] = [];
                  groups[target].push(item);
                  return groups;
                },
                {} as Record<string, JwstDataModel[]>
              )
            )
              .sort((a, b) => {
                if (a[0] === 'Unknown Target') return 1;
                if (b[0] === 'Unknown Target') return -1;
                return a[0].localeCompare(b[0]);
              })
              .map(([groupId, items]) => {
                // Collect unique instruments and filters in this target group
                const instruments = [
                  ...new Set(items.map((f) => f.imageInfo?.instrument).filter(Boolean)),
                ];
                const filters = [...new Set(items.map((f) => f.imageInfo?.filter).filter(Boolean))];

                return (
                  <div
                    key={groupId}
                    className={`data-group ${collapsedGroups.has(groupId) ? 'collapsed' : ''}`}
                  >
                    <div
                      className="group-header"
                      onClick={() => toggleGroupCollapse(groupId)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && toggleGroupCollapse(groupId)}
                      aria-expanded={!collapsedGroups.has(groupId)}
                    >
                      <div className="group-header-left">
                        <span className="collapse-icon">
                          {collapsedGroups.has(groupId) ? '▶' : '▼'}
                        </span>
                        <div className="group-title">
                          <h3>{groupId}</h3>
                          {/* Show unique instruments and filters in this target group */}
                          <div className="group-meta">
                            {instruments.length > 0 && (
                              <span className="instrument-list">{instruments.join(', ')}</span>
                            )}
                            {instruments.length > 0 && filters.length > 0 && (
                              <span className="meta-separator">•</span>
                            )}
                            {filters.length > 0 && (
                              <span className="filter-list">
                                {filters.slice(0, 5).join(', ')}
                                {filters.length > 5 ? '...' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="group-count">
                        {items.length} file{items.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {!collapsedGroups.has(groupId) && (
                      <div className="data-grid">
                        {items.map((item) => {
                          const fitsInfo = getFitsFileInfo(item.fileName);
                          const isSelectedForComposite = selectedForComposite.has(item.id);
                          const canSelectForComposite =
                            fitsInfo.viewable &&
                            (selectedForComposite.size < 3 || isSelectedForComposite);
                          return (
                            <div
                              key={item.id}
                              className={`data-card ${isSelectedForComposite ? 'selected-composite' : ''}`}
                            >
                              <div className="card-header">
                                {fitsInfo.viewable && (
                                  <button
                                    className={`composite-select-btn ${isSelectedForComposite ? 'selected' : ''}`}
                                    onClick={(e) => handleCompositeSelect(item.id, e)}
                                    disabled={!canSelectForComposite}
                                    title={
                                      isSelectedForComposite
                                        ? 'Remove from composite selection'
                                        : canSelectForComposite
                                          ? 'Add to RGB composite'
                                          : 'Maximum 3 images for composite'
                                    }
                                  >
                                    {isSelectedForComposite ? '✓' : '+'}
                                  </button>
                                )}
                                <h4>{item.fileName}</h4>
                                <div className="card-badges">
                                  <span
                                    className={`fits-type-badge ${fitsInfo.type}`}
                                    title={fitsInfo.description}
                                  >
                                    {fitsInfo.viewable ? '🖼️' : '📊'} {fitsInfo.label}
                                  </span>
                                  <span
                                    className={`status ${item.processingStatus}`}
                                    style={{ color: getStatusColor(item.processingStatus) }}
                                  >
                                    {item.processingStatus}
                                  </span>
                                </div>
                              </div>
                              <div className="card-content">
                                <p>
                                  <strong>Type:</strong> {item.dataType}
                                </p>
                                <p>
                                  <strong>Size:</strong> {(item.fileSize / 1024 / 1024).toFixed(2)}{' '}
                                  MB
                                </p>
                                {item.imageInfo?.observationDate && (
                                  <p>
                                    <strong>Observed:</strong>{' '}
                                    {new Date(item.imageInfo.observationDate).toLocaleDateString()}
                                  </p>
                                )}
                                <p>
                                  <strong>Downloaded:</strong>{' '}
                                  {new Date(item.uploadDate).toLocaleDateString()}
                                </p>
                                {item.description && (
                                  <p>
                                    <strong>Description:</strong> {item.description}
                                  </p>
                                )}
                                {item.tags.length > 0 && (
                                  <div className="tags">
                                    {item.tags.map((tag, index) => (
                                      <span key={index} className="tag">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="card-actions">
                                <button
                                  onClick={() => {
                                    setViewingImageId(item.id);
                                    setViewingImageTitle(item.fileName);
                                    setViewingImageMetadata(item.metadata);
                                  }}
                                  className={`view-file-btn ${!fitsInfo.viewable ? 'disabled' : ''}`}
                                  disabled={!fitsInfo.viewable}
                                  title={
                                    fitsInfo.viewable ? 'View FITS image' : fitsInfo.description
                                  }
                                >
                                  {fitsInfo.viewable ? 'View' : 'Table'}
                                </button>
                                <button
                                  onClick={() => handleProcessData(item.id, 'basic_analysis')}
                                >
                                  Analyze
                                </button>
                                <button
                                  onClick={() => handleProcessData(item.id, 'image_enhancement')}
                                >
                                  Enhance
                                </button>
                                <button
                                  className="archive-btn"
                                  onClick={() => handleArchive(item.id, item.isArchived)}
                                >
                                  {item.isArchived ? 'Unarchive' : 'Archive'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            {filteredData.length === 0 && (
              <div className="no-data">
                <h3>No data found</h3>
                <p>Upload some JWST data to get started!</p>
              </div>
            )}
          </div>
        ) : (
          <div className="lineage-view">
            {Object.entries(groupByLineage(filteredData))
              .sort((a, b) => {
                if (a[0] === 'Manual Uploads') return 1;
                if (b[0] === 'Manual Uploads') return -1;
                // Sort by most recent upload date (newest first)
                const aFiles = Object.values(a[1]).flat();
                const bFiles = Object.values(b[1]).flat();
                const aMaxDate = Math.max(...aFiles.map((f) => new Date(f.uploadDate).getTime()));
                const bMaxDate = Math.max(...bFiles.map((f) => new Date(f.uploadDate).getTime()));
                return bMaxDate - aMaxDate;
              })
              .map(([obsId, levels]) => {
                const isCollapsed = collapsedLineages.has(obsId);
                const totalFiles = Object.values(levels).flat().length;
                const levelOrder = ['L1', 'L2a', 'L2b', 'L3', 'unknown'];

                // Extract observation title, target, instrument, and dates from first file with metadata/imageInfo
                const allFiles = Object.values(levels).flat();
                const obsTitle = allFiles.find((f) => f.metadata?.mast_obs_title)?.metadata
                  ?.mast_obs_title as string | undefined;
                const fileWithInfo = allFiles.find(
                  (f) => f.imageInfo?.targetName || f.imageInfo?.instrument
                );
                const targetName = fileWithInfo?.imageInfo?.targetName;
                const instrument = fileWithInfo?.imageInfo?.instrument;
                const observationDate = allFiles.find((f) => f.imageInfo?.observationDate)
                  ?.imageInfo?.observationDate;
                const mostRecentUpload = allFiles.reduce((latest, f) =>
                  new Date(f.uploadDate) > new Date(latest.uploadDate) ? f : latest
                ).uploadDate;

                return (
                  <div key={obsId} className={`lineage-group ${isCollapsed ? 'collapsed' : ''}`}>
                    <div
                      className="lineage-header"
                      onClick={() => toggleLineageCollapse(obsId)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && toggleLineageCollapse(obsId)}
                      aria-expanded={!isCollapsed}
                    >
                      <div className="lineage-header-left">
                        <span className="collapse-icon">{isCollapsed ? '▶' : '▼'}</span>
                        <div className="lineage-title">
                          <h3>{obsId}</h3>
                          <div className="lineage-meta">
                            {obsTitle && <span className="obs-title">{obsTitle}</span>}
                            {obsTitle && (targetName || instrument) && (
                              <span className="meta-separator">•</span>
                            )}
                            {targetName && <span className="target-name">{targetName}</span>}
                            {targetName && instrument && <span className="meta-separator">•</span>}
                            {instrument && <span className="instrument-name">{instrument}</span>}
                            {(obsTitle || targetName || instrument) && observationDate && (
                              <span className="meta-separator">•</span>
                            )}
                            {observationDate && (
                              <span className="observation-date">
                                Observed: {new Date(observationDate).toLocaleDateString()}
                              </span>
                            )}
                            {observationDate && <span className="meta-separator">•</span>}
                            <span className="download-date">
                              Downloaded: {new Date(mostRecentUpload).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="lineage-header-right">
                        <div className="level-badges">
                          {levelOrder.map((level) => {
                            const count = levels[level]?.length || 0;
                            if (count === 0) return null;
                            return (
                              <span
                                key={level}
                                className="level-badge"
                                style={{ backgroundColor: getProcessingLevelColor(level) }}
                              >
                                {level}: {count}
                              </span>
                            );
                          })}
                        </div>
                        <span className="group-count">
                          {totalFiles} file{totalFiles !== 1 ? 's' : ''}
                        </span>
                        {obsId !== 'Manual Uploads' && (
                          <button
                            className="delete-observation-btn"
                            onClick={(e) => handleDeleteObservationClick(obsId, e)}
                            title="Delete this observation"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="lineage-tree">
                        {levelOrder.map((level) => {
                          const filesAtLevel = levels[level];
                          if (!filesAtLevel || filesAtLevel.length === 0) return null;

                          const levelKey = `${obsId}-${level}`;
                          const isExpanded = expandedLevels.has(levelKey);

                          // Calculate total size for files at this level
                          const levelTotalSize = filesAtLevel.reduce(
                            (sum, f) => sum + f.fileSize,
                            0
                          );

                          return (
                            <div key={level} className="lineage-level">
                              <div
                                className="level-header"
                                onClick={() => toggleLevelExpand(levelKey)}
                                role="button"
                                tabIndex={0}
                              >
                                <div className="level-connector">
                                  <span className="connector-line"></span>
                                  <span
                                    className="level-dot"
                                    style={{ backgroundColor: getProcessingLevelColor(level) }}
                                  ></span>
                                </div>
                                <span className="level-label">
                                  {getProcessingLevelLabel(level)}
                                </span>
                                <span className="level-count">
                                  ({filesAtLevel.length} files, {formatFileSize(levelTotalSize)})
                                </span>
                                <span className="expand-icon">{isExpanded ? '−' : '+'}</span>
                                {obsId !== 'Manual Uploads' && (
                                  <div className="level-actions">
                                    <button
                                      className="level-action-btn archive-btn"
                                      onClick={(e) => handleArchiveLevelClick(obsId, level, e)}
                                      disabled={isArchivingLevel}
                                      title={`Archive all ${level} files`}
                                    >
                                      📦
                                    </button>
                                    <button
                                      className="level-action-btn delete-btn"
                                      onClick={(e) => handleDeleteLevelClick(obsId, level, e)}
                                      title={`Delete all ${level} files`}
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                )}
                              </div>

                              {isExpanded && (
                                <div className="level-files">
                                  {filesAtLevel.map((item) => {
                                    const fitsInfo = getFitsFileInfo(item.fileName);
                                    const isSelectedForComposite = selectedForComposite.has(
                                      item.id
                                    );
                                    const canSelectForComposite =
                                      fitsInfo.viewable &&
                                      (selectedForComposite.size < 3 || isSelectedForComposite);
                                    return (
                                      <div
                                        key={item.id}
                                        className={`lineage-file-card ${isSelectedForComposite ? 'selected-composite' : ''}`}
                                      >
                                        <div className="file-header">
                                          {fitsInfo.viewable && (
                                            <button
                                              className={`composite-select-btn small ${isSelectedForComposite ? 'selected' : ''}`}
                                              onClick={(e) => handleCompositeSelect(item.id, e)}
                                              disabled={!canSelectForComposite}
                                              title={
                                                isSelectedForComposite
                                                  ? 'Remove from composite selection'
                                                  : canSelectForComposite
                                                    ? 'Add to RGB composite'
                                                    : 'Maximum 3 images for composite'
                                              }
                                            >
                                              {isSelectedForComposite ? '✓' : '+'}
                                            </button>
                                          )}
                                          <span className="file-name" title={item.fileName}>
                                            {item.fileName}
                                          </span>
                                          <div className="file-badges">
                                            <span
                                              className={`fits-type-badge small ${fitsInfo.type}`}
                                              title={fitsInfo.description}
                                            >
                                              {fitsInfo.viewable ? '🖼️' : '📊'}
                                            </span>
                                            <span
                                              className={`status ${item.processingStatus}`}
                                              style={{
                                                color: getStatusColor(item.processingStatus),
                                              }}
                                            >
                                              {item.processingStatus}
                                            </span>
                                          </div>
                                        </div>
                                        <div className="file-meta">
                                          <span>Type: {item.dataType}</span>
                                          <span>
                                            Size: {(item.fileSize / 1024 / 1024).toFixed(2)} MB
                                          </span>
                                          {item.imageInfo?.observationDate && (
                                            <span>
                                              Obs:{' '}
                                              {new Date(
                                                item.imageInfo.observationDate
                                              ).toLocaleDateString()}
                                            </span>
                                          )}
                                          <span className="fits-type-label">{fitsInfo.label}</span>
                                        </div>
                                        <div className="file-actions">
                                          <button
                                            onClick={() => {
                                              setViewingImageId(item.id);
                                              setViewingImageTitle(item.fileName);
                                              setViewingImageMetadata(item.metadata);
                                            }}
                                            className={!fitsInfo.viewable ? 'disabled' : ''}
                                            disabled={!fitsInfo.viewable}
                                            title={
                                              fitsInfo.viewable
                                                ? 'View FITS image'
                                                : fitsInfo.description
                                            }
                                          >
                                            {fitsInfo.viewable ? 'View' : 'Table'}
                                          </button>
                                          <button
                                            onClick={() =>
                                              handleProcessData(item.id, 'basic_analysis')
                                            }
                                          >
                                            Analyze
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            {filteredData.length === 0 && (
              <div className="no-data">
                <h3>No data found</h3>
                <p>Upload some JWST data to get started!</p>
              </div>
            )}
          </div>
        )}
      </div>

      <ImageViewer
        dataId={viewingImageId || ''}
        title={viewingImageTitle}
        isOpen={!!viewingImageId}
        onClose={() => setViewingImageId(null)}
        metadata={viewingImageMetadata}
      />

      {deleteModalData && (
        <div
          className="delete-modal-overlay"
          onClick={() => !isDeleting && setDeleteModalData(null)}
        >
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Observation</h3>
            <div className="delete-modal-content">
              <p className="delete-observation-id">
                <strong>Observation:</strong> {deleteModalData.observationBaseId}
              </p>
              <p className="delete-summary">
                <strong>{deleteModalData.fileCount}</strong> file
                {deleteModalData.fileCount !== 1 ? 's' : ''} (
                {formatFileSize(deleteModalData.totalSizeBytes)})
              </p>
              <div className="delete-file-list">
                <strong>Files to be deleted:</strong>
                <ul>
                  {deleteModalData.fileNames.map((fileName, index) => (
                    <li key={index}>{fileName}</li>
                  ))}
                </ul>
              </div>
              <p className="delete-warning">
                ⚠️ This will permanently delete {deleteModalData.fileCount} file
                {deleteModalData.fileCount !== 1 ? 's' : ''} (
                {formatFileSize(deleteModalData.totalSizeBytes)}). This cannot be undone.
              </p>
            </div>
            <div className="delete-modal-actions">
              <button
                className="delete-cancel-btn"
                onClick={() => setDeleteModalData(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="delete-confirm-btn"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteLevelModalData && (
        <div
          className="delete-modal-overlay"
          onClick={() => !isDeleting && setDeleteLevelModalData(null)}
        >
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Processing Level</h3>
            <div className="delete-modal-content">
              <p className="delete-observation-id">
                <strong>Observation:</strong> {deleteLevelModalData.observationBaseId}
              </p>
              <p className="delete-level-id">
                <strong>Processing Level:</strong>{' '}
                <span
                  className="level-badge"
                  style={{
                    backgroundColor: getProcessingLevelColor(deleteLevelModalData.processingLevel),
                  }}
                >
                  {deleteLevelModalData.processingLevel}
                </span>{' '}
                {getProcessingLevelLabel(deleteLevelModalData.processingLevel)}
              </p>
              <p className="delete-summary">
                <strong>{deleteLevelModalData.fileCount}</strong> file
                {deleteLevelModalData.fileCount !== 1 ? 's' : ''} (
                {formatFileSize(deleteLevelModalData.totalSizeBytes)})
              </p>
              <div className="delete-file-list">
                <strong>Files to be deleted:</strong>
                <ul>
                  {deleteLevelModalData.fileNames.map((fileName, index) => (
                    <li key={index}>{fileName}</li>
                  ))}
                </ul>
              </div>
              <p className="delete-warning">
                ⚠️ This will permanently delete {deleteLevelModalData.fileCount}{' '}
                {deleteLevelModalData.processingLevel} file
                {deleteLevelModalData.fileCount !== 1 ? 's' : ''} (
                {formatFileSize(deleteLevelModalData.totalSizeBytes)}). Other processing levels will
                be preserved. This cannot be undone.
              </p>
            </div>
            <div className="delete-modal-actions">
              <button
                className="delete-cancel-btn"
                onClick={() => setDeleteLevelModalData(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="delete-confirm-btn"
                onClick={handleConfirmDeleteLevel}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompositeWizard && (
        <CompositeWizard
          allImages={viewableImages}
          initialSelection={Array.from(selectedForComposite)}
          onClose={handleCloseCompositeWizard}
        />
      )}
    </div>
  );
};

export default JwstDataDashboard;
