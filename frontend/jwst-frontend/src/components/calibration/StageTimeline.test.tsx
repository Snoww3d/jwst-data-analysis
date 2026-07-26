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

  describe('running-stage detail (#1770)', () => {
    const twoRunning = [
      { name: 'detector1', status: 'running' as const },
      { name: 'image2', status: 'running' as const },
    ];

    it('attaches the step and file counter to the named stage only', () => {
      render(
        <StageTimeline
          mode="progress"
          progress={twoRunning}
          currentStageName="detector1"
          currentStep="jump"
          fileCounter="file 2 of 4"
        />
      );

      const details = document.querySelectorAll('.stage-node-detail');
      expect(details).toHaveLength(1);
      expect(details[0]).toHaveTextContent('jump · file 2 of 4');
      // …and it hangs off Detector1, not off the other running stage.
      expect(details[0].closest('.stage-node')).toHaveTextContent('Detector1');
    });

    it('shows nothing when the engine has not said which stage is current', () => {
      // Painting a counter onto every running stage is worse than omitting it;
      // the run page still shows it unattributed in the status line.
      render(<StageTimeline mode="progress" progress={twoRunning} fileCounter="file 2 of 4" />);
      expect(document.querySelectorAll('.stage-node-detail')).toHaveLength(0);
    });

    it('never decorates a stage that is not running', () => {
      render(
        <StageTimeline
          mode="progress"
          progress={[{ name: 'detector1', status: 'done' }]}
          currentStageName="detector1"
          currentStep="jump"
          fileCounter="file 4 of 4"
        />
      );
      expect(document.querySelectorAll('.stage-node-detail')).toHaveLength(0);
    });

    it('ignores the progress-only props in config mode', () => {
      render(
        <StageTimeline
          mode="config"
          enabled={{ detector1: true }}
          currentStageName="detector1"
          currentStep="jump"
          fileCounter="file 2 of 4"
        />
      );
      expect(document.querySelectorAll('.stage-node-detail')).toHaveLength(0);
    });
  });
});
