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
  const [showUploadForm, setShowUploadForm] = useState<boolean>(false);
  const [showMastSearch, setShowMastSearch] = useState<boolean>(false);
  const [viewingImageId, setViewingImageId] = useState<string | null>(null);
  const [viewingImageTitle, setViewingImageTitle] = useState<string>('');

  const filteredData = data.filter(item => {
    const matchesType = selectedDataType === 'all' || item.dataType === selectedDataType;
    const matchesSearch = item.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesType && matchesSearch;
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
          <button
            className={`mast-search-btn ${showMastSearch ? 'active' : ''}`}
            onClick={() => setShowMastSearch(!showMastSearch)}
          >
            {showMastSearch ? 'Hide MAST Search' : 'Search MAST'}
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
                <button onClick={() => handleProcessData(item.id, 'noise_reduction')}>
                  Reduce Noise
                </button>
              </div>
            </div>
          ))
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