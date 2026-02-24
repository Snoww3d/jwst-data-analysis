import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MastSearch from './MastSearch';

vi.mock('../services', () => ({
  mastService: {
    searchByTarget: vi.fn(() => Promise.resolve({ results: [] })),
    searchByCoordinates: vi.fn(() => Promise.resolve({ results: [] })),
    searchByObservation: vi.fn(() => Promise.resolve({ results: [] })),
    searchByProgram: vi.fn(() => Promise.resolve({ results: [] })),
    startImport: vi.fn(),
    getImportProgress: vi.fn(),
    cancelImport: vi.fn(),
    startBulkImport: vi.fn(),
    getBulkImportProgress: vi.fn(),
    getResumableJobs: vi.fn(() => Promise.resolve([])),
    getResumableImports: vi.fn(() => Promise.resolve({ jobs: [] })),
  },
  ApiError: {
    isApiError: vi.fn(() => false),
  },
}));

describe('MastSearch', () => {
  const defaultProps = {
    onImportComplete: vi.fn(),
    importedObsIds: new Set<string>(),
  };

  it('renders the heading', () => {
    render(<MastSearch {...defaultProps} />);
    expect(screen.getByText('MAST Portal Search')).toBeInTheDocument();
  });

  it('renders search type options', () => {
    render(<MastSearch {...defaultProps} />);
    expect(screen.getByText('Target Name')).toBeInTheDocument();
    expect(screen.getByText('Coordinates')).toBeInTheDocument();
  });
});
