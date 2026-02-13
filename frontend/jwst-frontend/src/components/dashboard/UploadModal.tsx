import React from 'react';
import './UploadModal.css';

interface UploadModalProps {
  onUpload: (file: File, dataType: string, description?: string, tags?: string[]) => Promise<void>;
  onClose: () => void;
}

const UploadModal: React.FC<UploadModalProps> = ({ onUpload, onClose }) => {
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem('file-upload') as HTMLInputElement;
    const dataTypeSelect = form.elements.namedItem('data-type-select') as HTMLSelectElement;
    const descriptionInput = form.querySelector('textarea') as HTMLTextAreaElement;
    const tagsInput = form.querySelectorAll('input[type="text"]')[0] as HTMLInputElement;

    if (!fileInput.files || fileInput.files.length === 0) {
      alert('Please select a file');
      return;
    }

    const file = fileInput.files[0];
    const description = descriptionInput.value || undefined;
    const tags = tagsInput.value
      ? tagsInput.value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t)
      : undefined;

    await onUpload(file, dataTypeSelect.value, description, tags);
  };

  return (
    <div className="upload-modal">
      <div className="upload-content">
        <h3>Upload JWST Data</h3>
        <form onSubmit={handleSubmit}>
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
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UploadModal;
