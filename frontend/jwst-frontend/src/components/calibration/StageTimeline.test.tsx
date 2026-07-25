import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StageTimeline } from './StageTimeline';

describe('StageTimeline', () => {
  it('labels stages in plain language and shows the data flow between them', () => {
    render(<StageTimeline mode="config" enabled={{ detector1: true }} />);
    // Human labels, not the raw engine identifiers the old checkboxes showed.
    expect(screen.getByText('Detector1')).toBeInTheDocument();
    expect(screen.getByText('Image3')).toBeInTheDocument();
    // The connector teaches what each stage consumes and produces.
    expect(screen.getByText('_uncal → _rate')).toBeInTheDocument();
    expect(screen.getByText('_cal → _i2d')).toBeInTheDocument();
  });

  it('disables a stage whose input product does not exist, and says why', () => {
    render(<StageTimeline mode="config" enabled={{ detector1: true }} inputSuffixes={['_cal']} />);

    const detector1 = screen.getByRole('checkbox', { name: /Detector1/ });
    expect(detector1).toBeDisabled();
    // Unreachable rather than a runtime failure hours later.
    expect(detector1).not.toBeChecked();
    expect(screen.getByText(/needs _uncal data/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Image3/ })).toBeEnabled();
  });

  it('toggles an allowed stage', async () => {
    const onToggle = vi.fn();
    render(<StageTimeline mode="config" enabled={{}} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Image2/ }));
    expect(onToggle).toHaveBeenCalledWith('image2', true);
  });

  it('renders live status without checkboxes in progress mode', () => {
    render(
      <StageTimeline
        mode="progress"
        progress={[
          { name: 'detector1', status: 'done' },
          { name: 'image2', status: 'running' },
        ]}
      />
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
  });
});
