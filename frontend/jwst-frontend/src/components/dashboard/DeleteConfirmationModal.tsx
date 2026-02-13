import React from 'react';
import { ProcessingLevelColors, ProcessingLevelLabels } from '../../types/JwstDataTypes';
import { formatFileSize } from '../../utils/formatUtils';
import './DeleteConfirmationModal.css';

interface DeleteConfirmationModalProps {
  variant: 'observation' | 'level';
  observationBaseId: string;
  processingLevel?: string;
  fileCount: number;
  totalSizeBytes: number;
  fileNames: string[];
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  variant,
  observationBaseId,
  processingLevel,
  fileCount,
  totalSizeBytes,
  fileNames,
  isDeleting,
  onConfirm,
  onCancel,
}) => {
  const title = variant === 'observation' ? 'Delete Observation' : 'Delete Processing Level';
  const levelColor = processingLevel
    ? ProcessingLevelColors[processingLevel] || ProcessingLevelColors['unknown']
    : undefined;
  const levelLabel = processingLevel
    ? ProcessingLevelLabels[processingLevel] || processingLevel
    : undefined;

  return (
    <div className="delete-modal-overlay" onClick={() => !isDeleting && onCancel()}>
      <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="delete-modal-content">
          <p className="delete-observation-id">
            <strong>Observation:</strong> {observationBaseId}
          </p>
          {variant === 'level' && processingLevel && (
            <p className="delete-level-id">
              <strong>Processing Level:</strong>{' '}
              <span className="level-badge" style={{ backgroundColor: levelColor }}>
                {processingLevel}
              </span>{' '}
              {levelLabel}
            </p>
          )}
          <p className="delete-summary">
            <strong>{fileCount}</strong> file{fileCount !== 1 ? 's' : ''} (
            {formatFileSize(totalSizeBytes)})
          </p>
          <div className="delete-file-list">
            <strong>Files to be deleted:</strong>
            <ul>
              {fileNames.map((fileName, index) => (
                <li key={index}>{fileName}</li>
              ))}
            </ul>
          </div>
          <p className="delete-warning">
            ⚠️ This will permanently delete {fileCount}{' '}
            {variant === 'level' && processingLevel ? `${processingLevel} ` : ''}file
            {fileCount !== 1 ? 's' : ''} ({formatFileSize(totalSizeBytes)}).
            {variant === 'level' ? ' Other processing levels will be preserved.' : ''} This cannot
            be undone.
          </p>
        </div>
        <div className="delete-modal-actions">
          <button className="delete-cancel-btn" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </button>
          <button className="delete-confirm-btn" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Deleting...' : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmationModal;
