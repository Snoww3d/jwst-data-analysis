import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JwstDataDashboard from './JwstDataDashboard';
import { getCapabilities } from '../services/calibrationService';

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
  default: (props: { onReprocess?: unknown }) => (
    <div data-testid="target-group-view" data-has-reprocess={String(Boolean(props.onReprocess))} />
  ),
}));

vi.mock('./dashboard/LineageView', () => ({
  default: (props: { onReprocess?: unknown }) => (
    <div data-testid="lineage-view" data-has-reprocess={String(Boolean(props.onReprocess))} />
  ),
}));

vi.mock('../services/calibrationService', () => ({
  getCapabilities: vi.fn(() => Promise.resolve({ calibrationEnabled: true, jwstVersion: '1.0' })),
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

  it('wires calibration into the DEFAULT view, not only the target view', async () => {
    // The bug this guards: the calibrate action was wired to TargetGroupView
    // only, while the library opens in lineage view — so the feature was
    // invisible where users actually land. Both views must get the handler,
    // or the same omission ships again silently.
    render(
      <MemoryRouter>
        <JwstDataDashboard data={[]} onDataUpdate={vi.fn()} />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByTestId('lineage-view')).toHaveAttribute('data-has-reprocess', 'true')
    );
  });

  it('offers no calibration anywhere when the engine says it is unavailable', async () => {
    vi.mocked(getCapabilities).mockResolvedValueOnce({
      calibrationEnabled: false,
      jwstVersion: null,
    });
    render(
      <MemoryRouter>
        <JwstDataDashboard data={[]} onDataUpdate={vi.fn()} />
      </MemoryRouter>
    );
    await waitFor(() =>
      expect(screen.getByTestId('lineage-view')).toHaveAttribute('data-has-reprocess', 'false')
    );
  });
});
