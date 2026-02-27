import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JwstDataDashboard from './JwstDataDashboard';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

// Mock all child components to isolate dashboard rendering
vi.mock('./MastSearch', () => ({
  default: () => <div data-testid="mast-search" />,
}));

vi.mock('./WhatsNewPanel', () => ({
  default: () => <div data-testid="whats-new-panel" />,
}));

vi.mock('./ImageViewer', () => ({
  default: () => <div data-testid="image-viewer" />,
}));

vi.mock('./TableViewer', () => ({
  default: () => <div data-testid="table-viewer" />,
}));

vi.mock('./SpectralViewer', () => ({
  default: () => <div data-testid="spectral-viewer" />,
}));

vi.mock('./ComparisonImagePicker', () => ({
  default: () => <div data-testid="comparison-picker" />,
}));

vi.mock('./ImageComparisonViewer', () => ({
  default: () => <div data-testid="comparison-viewer" />,
}));

vi.mock('./dashboard/DashboardToolbar', () => ({
  default: (_props: Record<string, unknown>) => <div data-testid="dashboard-toolbar" />,
}));

vi.mock('./dashboard/FloatingAnalysisBar', () => ({
  default: () => <div data-testid="floating-bar" />,
}));

vi.mock('./dashboard/TargetGroupView', () => ({
  default: () => <div data-testid="target-group-view" />,
}));

vi.mock('./dashboard/LineageView', () => ({
  default: () => <div data-testid="lineage-view" />,
}));

vi.mock('./dashboard/DeleteConfirmationModal', () => ({
  default: () => null,
}));

vi.mock('./dashboard/UploadModal', () => ({
  default: () => null,
}));

vi.mock('../services', () => ({
  jwstDataService: {
    deleteData: vi.fn(),
    deleteObservation: vi.fn(),
    deleteLevel: vi.fn(),
    archiveLevel: vi.fn(),
    updateArchiveStatus: vi.fn(),
    processData: vi.fn(),
  },
  ApiError: {
    isApiError: vi.fn(() => false),
  },
}));

describe('JwstDataDashboard', () => {
  it('renders the dashboard with toolbar and lineage view', () => {
    render(
      <MemoryRouter>
        <JwstDataDashboard data={[]} onDataUpdate={vi.fn()} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('dashboard-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('lineage-view')).toBeInTheDocument();
  });
});
