import React, { useState, useEffect } from 'react';
import './ImageViewer.css';

interface ImageViewerProps {
    dataId: string;
    title: string;
    onClose: () => void;
    isOpen: boolean;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ dataId, title, onClose, isOpen }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && dataId) {
            setLoading(true);
            setError(null);

            const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';
            const url = `${apiUrl}/api/jwstdata/${dataId}/preview`;

            setImageUrl(url);
            setLoading(false);
        }
    }, [dataId, isOpen]);

    // Handle escape key to close
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="image-viewer-overlay" onClick={onClose}>
            <div className="image-viewer-container" onClick={e => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    aria-label="Close viewer"
                    style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        backgroundColor: '#dc3545',
                        border: 'none',
                        color: 'white',
                        fontSize: '24px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                        zIndex: 10
                    }}
                >
                    ✕
                </button>

                <div className="image-viewer-header">
                    <h3>{title}</h3>
                </div>

                <div className="image-viewer-content">
                    {loading ? (
                        <div className="image-viewer-loading">
                            <div className="image-viewer-spinner"></div>
                            <p>Loading preview...</p>
                        </div>
                    ) : error ? (
                        <div className="image-viewer-error">
                            <p>Error loading image</p>
                            <p>{error}</p>
                        </div>
                    ) : (
                        <img
                            src={imageUrl || ''}
                            alt={`Preview of ${title}`}
                            onError={() => setError("Failed to load image preview")}
                            onLoad={() => setLoading(false)}
                        />
                    )}
                </div>

                <div className="image-viewer-footer">
                    <button
                        className="btn-secondary"
                        onClick={onClose}
                    >
                        Close
                    </button>
                    <button
                        className="btn-primary"
                        onClick={() => window.open(imageUrl || '', '_blank')}
                    >
                        Open in New Tab
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImageViewer;
