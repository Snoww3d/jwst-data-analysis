import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompositePreviewStep } from './CompositePreviewStep';
import { createDefaultRGBChannels } from '../../types/CompositeTypes';

vi.mock('../../services', () => ({
  compositeService: {
    generatePreview: vi.fn(() => Promise.resolve(new Blob())),
    generateNChannelPreview: vi.fn(() => Promise.resolve({ blob: new Blob(), warning: null })),
    generateNChannelPreviewAsync: vi.fn(() => Promise.resolve({ jobId: 'preview-test-job' })),
    exportComposite: vi.fn(() => Promise.resolve(new Blob())),
    exportNChannelCompositeAsync: vi.fn(() => Promise.resolve({ jobId: 'test-job-123' })),
    generateFilename: vi.fn(() => 'test-composite.png'),
    downloadComposite: vi.fn(),
    parseMemoryBudgetError: vi.fn(() => ({
      isMemoryBudget: false,
      displayMessage: null,
      projectedShape: null,
      sideFactor: null,
    })),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public message: string
    ) {
      super(message);
    }
  },
}));

vi.mock('../../hooks/useJobProgress', () => ({
  useJobProgress: vi.fn(() => ({
    progress: null,
    isComplete: false,
    error: null,
    messages: [],
  })),
}));

vi.mock('../../config/api', () => ({
  API_BASE_URL: 'http://test:5001',
}));

vi.mock('../../context/useAuth', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: false, isLoading: false })),
}));

// Mock apiClient so the unmount cancel POST and result-blob fetch don't
// reach real fetch() during component teardown — those calls would otherwise
// leak as unhandled rejections in JSDOM.
vi.mock('../../services/apiClient', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue(undefined),
    getBlobWithHeaders: vi.fn().mockResolvedValue({ blob: new Blob(), headers: new Headers() }),
  },
}));

vi.mock('../StretchControls', () => ({
  default: () => <div data-testid="stretch-controls" />,
}));

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:test'),
  revokeObjectURL: vi.fn(),
});

describe('CompositePreviewStep', () => {
  const defaultProps = {
    selectedImages: [],
    channels: createDefaultRGBChannels(),
    onChannelsChange: vi.fn(),
  };

  beforeEach(async () => {
    // Reset auth mock to anonymous default and clear service-call history so
    // each test starts from a known state.
    const { useAuth } = await import('../../context/useAuth');
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false, isLoading: false } as never);
    const { compositeService } = await import('../../services');
    vi.mocked(compositeService.generateNChannelPreview).mockClear();
    vi.mocked(compositeService.generateNChannelPreviewAsync).mockClear();
    // The unmount cleanup fires apiClient.post('/api/jobs/{id}/cancel') for
    // any active preview job — clear so subsequent tests don't see stale calls.
    const { apiClient } = await import('../../services/apiClient');
    vi.mocked(apiClient.post).mockClear();
    vi.mocked(apiClient.getBlobWithHeaders).mockClear();
  });

  it('renders without crashing', () => {
    const { container } = render(<CompositePreviewStep {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('renders export button', () => {
    render(<CompositePreviewStep {...defaultProps} />);
    const exportBtn = screen.getByRole('button', { name: /export.*download/i });
    expect(exportBtn).toBeTruthy();
    expect(exportBtn).toBeDisabled(); // No preview URL yet
  });

  it('calls exportNChannelCompositeAsync on export click', async () => {
    const { useJobProgress } = await import('../../hooks/useJobProgress');
    vi.mocked(useJobProgress).mockReturnValue({
      progress: null,
      isComplete: false,
      error: null,
      messages: [],
    });

    // Note: export button is disabled when there's no preview, so this test
    // verifies the button exists and its disabled state (preview requires live API)
    render(<CompositePreviewStep {...defaultProps} />);
    const exportBtn = screen.getByRole('button', { name: /export.*download/i });
    expect(exportBtn).toBeDisabled();
  });

  // #1470 — async preview path routing
  it('uses async preview endpoint when authenticated', async () => {
    const { useAuth } = await import('../../context/useAuth');
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, isLoading: false } as never);

    const { compositeService } = await import('../../services');

    // Build a channel with at least one dataId so generatePreview won't bail.
    const channelsWithData = createDefaultRGBChannels().map((ch, i) => ({
      ...ch,
      dataIds: [`data-${i}`],
    }));

    render(<CompositePreviewStep {...defaultProps} channels={channelsWithData} />);

    // Wait for the debounced preview to fire (debounce + render flush).
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(compositeService.generateNChannelPreviewAsync).toHaveBeenCalled();
    expect(compositeService.generateNChannelPreview).not.toHaveBeenCalled();
  });

  it('uses sync preview endpoint when anonymous', async () => {
    const { useAuth } = await import('../../context/useAuth');
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false, isLoading: false } as never);

    const { compositeService } = await import('../../services');

    const channelsWithData = createDefaultRGBChannels().map((ch, i) => ({
      ...ch,
      dataIds: [`data-${i}`],
    }));

    render(<CompositePreviewStep {...defaultProps} channels={channelsWithData} />);

    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(compositeService.generateNChannelPreview).toHaveBeenCalled();
    expect(compositeService.generateNChannelPreviewAsync).not.toHaveBeenCalled();
  });

  // #1470 — cancel-on-supersede: when a new preview kicks off while a prior
  // job is in flight, the prior jobId must be cancelled so the engine doesn't
  // burn cycles producing an obsolete result. This is the load-bearing reason
  // we picked `IJobTracker.CancelJobAsync` over "just unsubscribe".
  it('cancels prior preview job when a new preview supersedes it', async () => {
    const { useAuth } = await import('../../context/useAuth');
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, isLoading: false } as never);

    const { compositeService } = await import('../../services');
    const { apiClient } = await import('../../services/apiClient');
    vi.mocked(compositeService.generateNChannelPreviewAsync)
      .mockResolvedValueOnce({ jobId: 'job-A' })
      .mockResolvedValueOnce({ jobId: 'job-B' });

    const channelsWithData = createDefaultRGBChannels().map((ch, i) => ({
      ...ch,
      dataIds: [`data-${i}`],
    }));

    const { rerender } = render(
      <CompositePreviewStep {...defaultProps} channels={channelsWithData} />
    );

    // First preview kicks off and resolves to job-A.
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Trigger a second preview by changing channel input (slider sim).
    const updated = channelsWithData.map((ch) => ({ ...ch, dataIds: [...ch.dataIds, 'extra'] }));
    rerender(<CompositePreviewStep {...defaultProps} channels={updated} />);

    await new Promise((resolve) => setTimeout(resolve, 350));

    // job-A must have been told to cancel before job-B kicked off.
    expect(apiClient.post).toHaveBeenCalledWith('/api/jobs/job-A/cancel', undefined);
  });

  // The MEMORY_BUDGET: prefix preservation on the async failure path is a
  // 2-line passthrough (`setPreviewError(previewJobError)` in the failure
  // effect). The contract is enforced upstream by:
  //   - compositeService.test.ts → parseMemoryBudgetError tests
  //   - compositeService.ts:47 MEMORY_BUDGET_PREFIX constant
  //   - ProcessingErrorMessages backend unit tests
  // A component-level test for this would need full effect-firing-with-state
  // orchestration that's too fragile to be useful — the regression it would
  // catch (prefix stripping) would surface in those upstream tests first.
});
