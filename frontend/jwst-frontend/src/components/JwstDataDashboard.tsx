import React, { useState } from 'react';
import { JwstDataModel } from '../types/JwstDataTypes';
import MastSearch from './MastSearch';
import ImageViewer from './ImageViewer';
import './JwstDataDashboard.css';

interface JwstDataDashboardProps {
  data: JwstDataModel[];
  onDataUpdate: () => void;
}

const JwstDataDashboard: React.FC<JwstDataDashboardProps> = ({ data, onDataUpdate }) => {
  const [selectedDataType, setSelectedDataType] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'grouped'>('grid');
  const [showUploadForm, setShowUploadForm] = useState<boolean>(false);
  const [showMastSearch, setShowMastSearch] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [viewingImageId, setViewingImageId] = useState<string | null>(null);
  const [viewingImageTitle, setViewingImageTitle] = useState<string>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const filteredData = data.filter(item => {
    const matchesType = selectedDataType === 'all' || item.dataType === selectedDataType;
    const matchesSearch = item.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesArchived = showArchived ? item.isArchived : !item.isArchived;
    return matchesType && matchesSearch && matchesArchived;
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
    const formData = new FormData();
    formData.append('File', file);
    formData.append('DataType', dataTypeSelect.value);
    formData.append('Description', descriptionInput.value);

    // Parse tags (comma separated)
    if (tagsInput.value) {
      const tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t);
      tags.forEach(tag => formData.append('Tags', tag));
    }

    try {
      const response = await fetch('http://localhost:5001/api/jwstdata/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        alert('File uploaded successfully!');
        setShowUploadForm(false);
        onDataUpdate(); // Refresh the list
      } else {
        const errorText = await response.text();
        alert(`Upload failed: ${errorText}`);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Error uploading file');
    }
  };

  const handleProcessData = async (dataId: string, algorithm: string) => {
    try {
      const response = await fetch(`http://localhost:5001/api/jwstdata/${dataId}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          algorithm,
          parameters: {}
        })
      });

      if (response.ok) {
        alert('Processing started successfully!');
        onDataUpdate();
      } else {
        alert('Failed to start processing');
      }
    } catch (error) {
      console.error('Error processing data:', error);
      alert('Error processing data');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'green';
      case 'processing': return 'orange';
      case 'failed': return 'red';
      default: return 'gray';
    }
  };

  const handleArchive = async (dataId: string, isCurrentlyArchived: boolean) => {
    try {
      const endpoint = isCurrentlyArchived ? 'unarchive' : 'archive';
      const response = await fetch(`http://localhost:5001/api/jwstdata/${dataId}/${endpoint}`, {
        method: 'POST',
      });

      if (response.ok) {
        onDataUpdate();
      } else {
        alert(`Failed to ${endpoint} file`);
      }
    } catch (error) {
      console.error(`Error ${isCurrentlyArchived ? 'unarchiving' : 'archiving'} data:`, error);
      alert('Error updating archive status');
    }
  };

  const handleImportMast = async () => {
    try {
      const response = await fetch('http://localhost:5001/api/datamanagement/import/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Import complete: ${result.importedCount} files imported, ${result.skippedCount} skipped`);
        onDataUpdate();
      } else {
        alert('Failed to import files');
      }
    } catch (error) {
      console.error('Error importing files:', error);
      alert('Error importing files');
    }
  };

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
            <label htmlFor="data-type-filter" className="visually-hidden">Filter by Data Type</label>
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
            </select>
          </div>
          <button
            className="upload-btn"
            onClick={() => setShowUploadForm(true)}
          >
            Upload Data
          </button>
          <div className="view-toggle">
            <button
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <span className="icon">⊞</span> Grid
            </button>
            <button
              className={`view-btn ${viewMode === 'grouped' ? 'active' : ''}`}
              onClick={() => setViewMode('grouped')}
              title="Group by Observation"
            >
              <span className="icon">≡</span> Grouped
            </button>
          </div>
          <button
            className={`mast-search-btn ${showMastSearch ? 'active' : ''}`}
            onClick={() => setShowMastSearch(!showMastSearch)}
          >
            {showMastSearch ? 'Hide MAST Search' : 'Search MAST'}
          </button>
          <button
            className={`archived-toggle ${showArchived ? 'active' : ''}`}
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? 'Show Active' : 'Show Archived'}
          </button>
          <button
            className="import-mast-btn"
            onClick={handleImportMast}
          >
            Import MAST Files
          </button>
        </div>
      </div>

      {showMastSearch && (
        <MastSearch onImportComplete={onDataUpdate} />
      )}

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
                <select
                  id="data-type-select"
                  required
                  title="Select the data type"
                >
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
                <button type="button" onClick={() => setShowUploadForm(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="data-content">
        {viewMode === 'grouped' ? (
          <div className="grouped-view">
            {Object.entries(
              filteredData.reduce((groups, item) => {
                const obsId = item.metadata?.mast_obs_id || 'Manual Uploads / Other';
                if (!groups[obsId]) groups[obsId] = [];
                groups[obsId].push(item);
                return groups;
              }, {} as Record<string, JwstDataModel[]>)
            ).sort((a, b) => {
              if (a[0] === 'Manual Uploads / Other') return 1;
              if (b[0] === 'Manual Uploads / Other') return -1;
              return a[0].localeCompare(b[0]);
            }).map(([groupId, items]) => (
              <div key={groupId} className={`data-group ${collapsedGroups.has(groupId) ? 'collapsed' : ''}`}>
                <div
                  className="group-header"
                  onClick={() => toggleGroupCollapse(groupId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && toggleGroupCollapse(groupId)}
                  aria-expanded={!collapsedGroups.has(groupId)}
                >
                  <div className="group-header-left">
                    <span className="collapse-icon">{collapsedGroups.has(groupId) ? '▶' : '▼'}</span>
                    <h3>{groupId}</h3>
                  </div>
                  <span className="group-count">{items.length} file{items.length !== 1 ? 's' : ''}</span>
                </div>
                {!collapsedGroups.has(groupId) && (
                <div className="data-grid">
                  {items.map((item) => (
                    <div key={item.id} className="data-card">
                      <div className="card-header">
                        <h4>{item.fileName}</h4>
                        <span
                          className={`status ${item.processingStatus}`}
                          style={{ color: getStatusColor(item.processingStatus) }}
                        >
                          {item.processingStatus}
                        </span>
                      </div>
                      <div className="card-content">
                        <p><strong>Type:</strong> {item.dataType}</p>
                        <p><strong>Size:</strong> {(item.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                        <p><strong>Uploaded:</strong> {new Date(item.uploadDate).toLocaleDateString()}</p>
                        {item.description && (
                          <p><strong>Description:</strong> {item.description}</p>
                        )}
                        {item.tags.length > 0 && (
                          <div className="tags">
                            {item.tags.map((tag, index) => (
                              <span key={index} className="tag">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="card-actions">
                        <button
                          onClick={() => {
                            setViewingImageId(item.id);
                            setViewingImageTitle(item.fileName);
                          }}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
                        >
                          View
                        </button>
                        <button onClick={() => handleProcessData(item.id, 'basic_analysis')}>
                          Analyze
                        </button>
                        <button onClick={() => handleProcessData(item.id, 'image_enhancement')}>
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
                  ))}
                </div>
                )}
              </div>
            ))}
            {filteredData.length === 0 && (
              <div className="no-data">
                <h3>No data found</h3>
                <p>Upload some JWST data to get started!</p>
              </div>
            )}
          </div>
        ) : (
          <div className="data-grid">
            {filteredData.length === 0 ? (
              <div className="no-data">
                <h3>No data found</h3>
                <p>Upload some JWST data to get started!</p>
              </div>
            ) : (
              filteredData.map((item) => (
                <div key={item.id} className="data-card">
                  <div className="card-header">
                    <h4>{item.fileName}</h4>
                    <span
                      className={`status ${item.processingStatus}`}
                      style={{ color: getStatusColor(item.processingStatus) }}
                    >
                      {item.processingStatus}
                    </span>
                  </div>
                  <div className="card-content">
                    <p><strong>Type:</strong> {item.dataType}</p>
                    <p><strong>Size:</strong> {(item.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                    <p><strong>Uploaded:</strong> {new Date(item.uploadDate).toLocaleDateString()}</p>
                    {item.description && (
                      <p><strong>Description:</strong> {item.description}</p>
                    )}
                    {item.tags.length > 0 && (
                      <div className="tags">
                        {item.tags.map((tag, index) => (
                          <span key={index} className="tag">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="card-actions">
                    <button
                      onClick={() => {
                        setViewingImageId(item.id);
                        setViewingImageTitle(item.fileName);
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
                    >
                      View
                    </button>
                    <button onClick={() => handleProcessData(item.id, 'basic_analysis')}>
                      Analyze
                    </button>
                    <button onClick={() => handleProcessData(item.id, 'image_enhancement')}>
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
              ))
            )}
          </div>
        )}
      </div>

      <ImageViewer
        dataId={viewingImageId || ''}
        title={viewingImageTitle}
        isOpen={!!viewingImageId}
        onClose={() => setViewingImageId(null)}
      />
    </div >
  );
};

export default JwstDataDashboard; 