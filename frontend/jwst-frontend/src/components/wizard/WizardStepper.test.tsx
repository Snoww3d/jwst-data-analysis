import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardStepper } from './WizardStepper';

const steps = [
  { number: 1, label: 'Select' },
  { number: 2, label: 'Configure' },
  { number: 3, label: 'Preview' },
];

describe('WizardStepper', () => {
  it('renders all step labels', () => {
    render(<WizardStepper steps={steps} currentStep={1} />);

    expect(screen.getByText('Select')).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('active step has active class', () => {
    render(<WizardStepper steps={steps} currentStep={2} />);

    const buttons = screen.getAllByRole('button');
    // Step 2 (index 1) should be active
    expect(buttons[1]).toHaveClass('active');
    // Steps 1 and 3 should not be active
    expect(buttons[0]).not.toHaveClass('active');
    expect(buttons[2]).not.toHaveClass('active');
  });

  it('completed steps have completed class and show checkmark SVG', () => {
    render(<WizardStepper steps={steps} currentStep={3} />);

    const buttons = screen.getAllByRole('button');
    // Steps 1 and 2 are completed (number < currentStep)
    expect(buttons[0]).toHaveClass('completed');
    expect(buttons[1]).toHaveClass('completed');
    // Step 3 is active, not completed
    expect(buttons[2]).not.toHaveClass('completed');

    // Completed steps should have SVG checkmarks
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBe(2);
  });

  it('renders step connectors between steps but not after the last', () => {
    const { container } = render(<WizardStepper steps={steps} currentStep={1} />);

    const connectors = container.querySelectorAll('.step-connector');
    // 3 steps => 2 connectors
    expect(connectors.length).toBe(2);
  });

  it('clickable steps call onStepClick when clicked', () => {
    const handleClick = vi.fn();
    render(<WizardStepper steps={steps} currentStep={2} onStepClick={handleClick} />);

    const buttons = screen.getAllByRole('button');
    // Step 1 is completed and clickable (number <= currentStep with onStepClick)
    fireEvent.click(buttons[0]);
    expect(handleClick).toHaveBeenCalledWith(1);

    // Step 2 is current and clickable
    fireEvent.click(buttons[1]);
    expect(handleClick).toHaveBeenCalledWith(2);
  });

  it('future steps are disabled (number > currentStep)', () => {
    const handleClick = vi.fn();
    render(<WizardStepper steps={steps} currentStep={1} onStepClick={handleClick} />);

    const buttons = screen.getAllByRole('button');
    // Step 2 and 3 are future, should be disabled
    expect(buttons[1]).toBeDisabled();
    expect(buttons[2]).toBeDisabled();
    // Step 1 is current and clickable
    expect(buttons[0]).not.toBeDisabled();
  });

  it('works with no onStepClick (all buttons disabled)', () => {
    render(<WizardStepper steps={steps} currentStep={2} />);

    const buttons = screen.getAllByRole('button');
    // Without onStepClick, all buttons are disabled since isClickable is always false
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });
});
