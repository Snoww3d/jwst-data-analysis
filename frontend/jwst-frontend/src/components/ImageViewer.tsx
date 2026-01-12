import React, { useState, useEffect } from 'react';

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

            // Construct the API URL for the preview image
            // Assuming the API base URL is available in environment variables or defaulting to localhost
            // Note: In a real app, use a proper API client or context
            const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';
            const url = `${apiUrl}/api/jwstdata/${dataId}/preview`;

            setImageUrl(url);
            setLoading(false);
        }
    }, [dataId, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-gray-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-700" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800">
                    <h3 className="text-xl font-bold text-white truncate">{title}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors focus:outline-none"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-auto bg-black flex items-center justify-center p-4 min-h-[300px]">
                    {loading ? (
                        <div className="flex flex-col items-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                            <p className="text-gray-400">Loading preview...</p>
                        </div>
                    ) : error ? (
                        <div className="text-red-400 text-center p-4">
                            <p className="mb-2">Error loading image</p>
                            <p className="text-sm opacity-75">{error}</p>
                        </div>
                    ) : (
                        <img
                            src={imageUrl || ''}
                            alt={`Preview of ${title}`}
                            className="max-w-full max-h-full object-contain"
                            onError={() => setError("Failed to load image preview")}
                            onLoad={() => setLoading(false)}
                        />
                    )}
                </div>

                <div className="p-4 bg-gray-800 border-t border-gray-700 flex justify-end">
                    <button
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
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
