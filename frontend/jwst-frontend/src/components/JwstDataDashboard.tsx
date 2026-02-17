import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  JwstDataModel,
  DeleteObservationResponse,
  DeleteLevelResponse,
  ImageMetadata,
} from '../types/JwstDataTypes';
import MastSearch from './MastSearch';
import WhatsNewPanel from './WhatsNewPanel';
import ImageViewer from './ImageViewer';
import CompositeWizard from './CompositeWizard';
import MosaicWizard from './MosaicWizard';
import ComparisonImagePicker, { ImageSelection } from './ComparisonImagePicker';
import ImageComparisonViewer from './ImageComparisonViewer';
import DashboardToolbar from './dashboard/DashboardToolbar';
import FloatingAnalysisBar from './dashboard/FloatingAnalysisBar';
import TargetGroupView from './dashboard/TargetGroupView';
import LineageView from './dashboard/LineageView';
import DeleteConfirmationModal from './dashboard/DeleteConfirmationModal';
import UploadModal from './dashboard/UploadModal';
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
  const [selectedTag, setSelectedTag] = useState<string>('all');
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
  const [viewingImageInfo, setViewingImageInfo] = useState<ImageMetadata | undefined>(undefined);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedLineages, setCollapsedLineages] = useState<Set<string>>(new Set());
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set());
  const [deleteModalData, setDeleteModalData] = useState<DeleteObservationResponse | null>(null);
  const [deleteLevelModalData, setDeleteLevelModalData] = useState<DeleteLevelResponse | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isArchivingLevel, setIsArchivingLevel] = useState<boolean>(false);
  const [archivingIds, setArchivingIds] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showCompositeWizard, setShowCompositeWizard] = useState<boolean>(false);
  const [showMosaicWizard, setShowMosaicWizard] = useState<boolean>(false);
  const [showComparisonPicker, setShowComparisonPicker] = useState<boolean>(false);
  const [comparisonPickerInitialA, setComparisonPickerInitialA] = useState<
    ImageSelection | undefined
  >(undefined);
  const [comparisonImageA, setComparisonImageA] = useState<ImageSelection | null>(null);
  const [comparisonImageB, setComparisonImageB] = useState<ImageSelection | null>(null);
  const [showFloatingBar, setShowFloatingBar] = useState(false);
  const analysisRowRef = useRef<HTMLDivElement>(null);

  // Extract unique observation IDs that have been imported (for MAST search display)
  const importedObsIds = useMemo(() => {
    const ids = new Set<string>();
    data.forEach((item) => {
      if (item.observationBaseId) {
        ids.add(item.observationBaseId);
      }
    });
    return ids;
  }, [data]);

  // --- Toggle handlers ---

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

  // Helper: check viewability for an item
  const isItemViewable = (item: JwstDataModel) =>
    item.isViewable !== undefined ? item.isViewable : getFitsFileInfo(item.fileName).viewable;

  // --- Cascading filter chain ---

  const baseFiltered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    // Normalize hyphens/underscores to spaces so "crab-nebula" matches "crab nebula"
    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ');
    const normalizedTerm = normalize(searchTerm.trim());
    return data.filter((item) => {
      const matchesArchived = showArchived ? item.isArchived : !item.isArchived;
      const matchesSearch =
        !term ||
        normalize(item.fileName).includes(normalizedTerm) ||
        (item.description && normalize(item.description).includes(normalizedTerm)) ||
        (item.imageInfo?.targetName &&
          normalize(item.imageInfo.targetName).includes(normalizedTerm)) ||
        item.tags.some((tag) => normalize(tag).includes(normalizedTerm));
      return matchesArchived && matchesSearch;
    });
  }, [data, searchTerm, showArchived]);

  const availableTypes = useMemo(() => {
    const counts = new Map<string, number>();
    let viewableCount = 0;
    let tableCount = 0;
    baseFiltered.forEach((item) => {
      const dt = item.dataType;
      counts.set(dt, (counts.get(dt) || 0) + 1);
      if (isItemViewable(item)) viewableCount++;
      else tableCount++;
    });
    return { dataTypeCounts: counts, viewableCount, tableCount };
  }, [baseFiltered]);

  const afterTypeFilter = useMemo(() => {
    return baseFiltered.filter((item) => {
      const matchesType = selectedDataType === 'all' || item.dataType === selectedDataType;
      const matchesViewability =
        selectedViewability === 'all' ||
        (selectedViewability === 'viewable' && isItemViewable(item)) ||
        (selectedViewability === 'table' && !isItemViewable(item));
      return matchesType && matchesViewability;
    });
  }, [baseFiltered, selectedDataType, selectedViewability]);

  const availableLevels = useMemo(() => {
    const counts = new Map<string, number>();
    afterTypeFilter.forEach((item) => {
      const lvl = item.processingLevel || 'unknown';
      counts.set(lvl, (counts.get(lvl) || 0) + 1);
    });
    return counts;
  }, [afterTypeFilter]);

  const afterLevelFilter = useMemo(() => {
    if (selectedProcessingLevel === 'all') return afterTypeFilter;
    return afterTypeFilter.filter(
      (item) => (item.processingLevel || 'unknown') === selectedProcessingLevel
    );
  }, [afterTypeFilter, selectedProcessingLevel]);

  const availableTags = useMemo(() => {
    const tagsByKey = new Map<string, { label: string; count: number }>();
    afterLevelFilter.forEach((item) => {
      item.tags.forEach((tag) => {
        const trimmedTag = tag.trim();
        if (!trimmedTag) return;
        const key = trimmedTag.toLowerCase();
        const existing = tagsByKey.get(key);
        if (existing) {
          existing.count++;
        } else {
          tagsByKey.set(key, { label: trimmedTag, count: 1 });
        }
      });
    });
    return Array.from(tagsByKey.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [afterLevelFilter]);

  // Auto-reset downstream filters when upstream changes make current selection invalid
  useEffect(() => {
    if (selectedProcessingLevel !== 'all' && !availableLevels.has(selectedProcessingLevel)) {
      setSelectedProcessingLevel('all');
    }
  }, [availableLevels, selectedProcessingLevel]);

  useEffect(() => {
    if (selectedTag !== 'all' && !availableTags.some((t) => t.value === selectedTag)) {
      setSelectedTag('all');
    }
  }, [availableTags, selectedTag]);

  // Track when analysis row scrolls out of view to show floating bar
  useEffect(() => {
    const el = analysisRowRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowFloatingBar(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const filteredData = useMemo(() => {
    if (selectedTag === 'all') return afterLevelFilter;
    return afterLevelFilter.filter((item) =>
      item.tags.some((tag) => tag.toLowerCase() === selectedTag)
    );
  }, [afterLevelFilter, selectedTag]);

  // --- Action handlers ---

  const handleUpload = async (
    file: File,
    dataType: string,
    description?: string,
    tags?: string[]
  ) => {
    try {
      await jwstDataService.upload(file, dataType, description, tags);
      alert('File uploaded successfully!');
      setShowUploadForm(false);
      onDataUpdate();
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

  const handleArchive = async (dataId: string, isCurrentlyArchived: boolean) => {
    setArchivingIds((prev) => new Set(prev).add(dataId));
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
    } finally {
      setArchivingIds((prev) => {
        const next = new Set(prev);
        next.delete(dataId);
        return next;
      });
    }
  };

  const handleDeleteObservationClick = async (
    observationBaseId: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    try {
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
    event.stopPropagation();
    try {
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
    event.stopPropagation();
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

  const handleFileSelect = (dataId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dataId)) {
        newSet.delete(dataId);
      } else {
        newSet.add(dataId);
      }
      return newSet;
    });
  };

  const handleCloseCompositeWizard = () => {
    setShowCompositeWizard(false);
    setSelectedFiles(new Set());
  };

  const handleCloseMosaicWizard = () => {
    setShowMosaicWizard(false);
    setSelectedFiles(new Set());
  };

  const handleViewItem = (item: JwstDataModel) => {
    setViewingImageId(item.id);
    setViewingImageTitle(item.fileName);
    setViewingImageMetadata(item.metadata);
    setViewingImageInfo(item.imageInfo);
  };

  // Get only viewable images for composite selection
  const viewableImages = data.filter((item) => {
    const fitsInfo = getFitsFileInfo(item.fileName);
    return fitsInfo.viewable && !item.isArchived;
  });

  return (
    <div className="dashboard">
      <DashboardToolbar
        searchTerm={searchTerm}
        selectedDataType={selectedDataType}
        selectedProcessingLevel={selectedProcessingLevel}
        selectedViewability={selectedViewability}
        selectedTag={selectedTag}
        onSearchChange={setSearchTerm}
        onDataTypeChange={setSelectedDataType}
        onProcessingLevelChange={setSelectedProcessingLevel}
        onViewabilityChange={setSelectedViewability}
        onTagChange={setSelectedTag}
        baseFilteredCount={baseFiltered.length}
        afterTypeFilterCount={afterTypeFilter.length}
        afterLevelFilterCount={afterLevelFilter.length}
        availableTypes={availableTypes}
        availableLevels={availableLevels}
        availableTags={availableTags}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived(!showArchived)}
        onShowUpload={() => setShowUploadForm(true)}
        showMastSearch={showMastSearch}
        onToggleMastSearch={() => setShowMastSearch(!showMastSearch)}
        showWhatsNew={showWhatsNew}
        onToggleWhatsNew={() => setShowWhatsNew(!showWhatsNew)}
        selectedCount={selectedFiles.size}
        onOpenCompositeWizard={() => setShowCompositeWizard(true)}
        onOpenMosaicWizard={() => setShowMosaicWizard(true)}
        onOpenComparisonPicker={() => {
          setComparisonPickerInitialA(undefined);
          setShowComparisonPicker(true);
        }}
        analysisRowRef={analysisRowRef}
      />

      {showMastSearch && (
        <MastSearch onImportComplete={onDataUpdate} importedObsIds={importedObsIds} />
      )}

      {showWhatsNew && <WhatsNewPanel onImportComplete={onDataUpdate} />}

      {showUploadForm && (
        <UploadModal onUpload={handleUpload} onClose={() => setShowUploadForm(false)} />
      )}

      <div className="data-content">
        {viewMode === 'target' ? (
          <TargetGroupView
            filteredData={filteredData}
            collapsedGroups={collapsedGroups}
            selectedFiles={selectedFiles}
            selectedTag={selectedTag}
            archivingIds={archivingIds}
            onToggleGroup={toggleGroupCollapse}
            onFileSelect={handleFileSelect}
            onView={handleViewItem}
            onProcess={handleProcessData}
            onArchive={handleArchive}
            onTagClick={setSelectedTag}
          />
        ) : (
          <LineageView
            filteredData={filteredData}
            collapsedLineages={collapsedLineages}
            expandedLevels={expandedLevels}
            selectedFiles={selectedFiles}
            archivingIds={archivingIds}
            onToggleLineage={toggleLineageCollapse}
            onToggleLevel={toggleLevelExpand}
            onDeleteObservation={handleDeleteObservationClick}
            onDeleteLevel={handleDeleteLevelClick}
            onArchiveLevel={handleArchiveLevelClick}
            isArchivingLevel={isArchivingLevel}
            onFileSelect={handleFileSelect}
            onView={handleViewItem}
            onProcess={handleProcessData}
            onArchive={handleArchive}
          />
        )}
      </div>

      <ImageViewer
        dataId={viewingImageId || ''}
        title={viewingImageTitle}
        isOpen={!!viewingImageId}
        onClose={() => setViewingImageId(null)}
        metadata={viewingImageMetadata}
        imageInfo={viewingImageInfo}
        onCompare={() => {
          if (viewingImageId) {
            setComparisonPickerInitialA({
              dataId: viewingImageId,
              title: viewingImageTitle,
              metadata: viewingImageMetadata,
            });
            setShowComparisonPicker(true);
          }
        }}
      />

      {deleteModalData && (
        <DeleteConfirmationModal
          variant="observation"
          observationBaseId={deleteModalData.observationBaseId}
          fileCount={deleteModalData.fileCount}
          totalSizeBytes={deleteModalData.totalSizeBytes}
          fileNames={deleteModalData.fileNames}
          isDeleting={isDeleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteModalData(null)}
        />
      )}

      {deleteLevelModalData && (
        <DeleteConfirmationModal
          variant="level"
          observationBaseId={deleteLevelModalData.observationBaseId}
          processingLevel={deleteLevelModalData.processingLevel}
          fileCount={deleteLevelModalData.fileCount}
          totalSizeBytes={deleteLevelModalData.totalSizeBytes}
          fileNames={deleteLevelModalData.fileNames}
          isDeleting={isDeleting}
          onConfirm={handleConfirmDeleteLevel}
          onCancel={() => setDeleteLevelModalData(null)}
        />
      )}

      {showCompositeWizard && (
        <CompositeWizard
          allImages={viewableImages}
          initialSelection={Array.from(selectedFiles)}
          onClose={handleCloseCompositeWizard}
        />
      )}

      {showMosaicWizard && (
        <MosaicWizard
          allImages={viewableImages}
          initialSelection={Array.from(selectedFiles)}
          onMosaicSaved={onDataUpdate}
          onClose={handleCloseMosaicWizard}
        />
      )}

      {showComparisonPicker && (
        <ComparisonImagePicker
          allImages={viewableImages}
          initialImageA={comparisonPickerInitialA}
          onSelect={(a, b) => {
            setComparisonImageA(a);
            setComparisonImageB(b);
            setShowComparisonPicker(false);
          }}
          onClose={() => setShowComparisonPicker(false)}
        />
      )}

      {comparisonImageA && comparisonImageB && (
        <ImageComparisonViewer
          imageA={comparisonImageA}
          imageB={comparisonImageB}
          isOpen={true}
          onClose={() => {
            setComparisonImageA(null);
            setComparisonImageB(null);
          }}
        />
      )}

      <FloatingAnalysisBar
        visible={showFloatingBar}
        selectedCount={selectedFiles.size}
        onOpenCompositeWizard={() => setShowCompositeWizard(true)}
        onOpenMosaicWizard={() => setShowMosaicWizard(true)}
        onOpenComparisonPicker={() => {
          setComparisonPickerInitialA(undefined);
          setShowComparisonPicker(true);
        }}
      />
    </div>
  );
};

export default JwstDataDashboard;
