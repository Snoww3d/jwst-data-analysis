import React from 'react';
import './WizardStepper.css';

interface Step {
  number: number;
  label: string;
}

interface WizardStepperProps {
  steps: Step[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

/**
 * Reusable step indicator component for wizard flows
 */
export const WizardStepper: React.FC<WizardStepperProps> = ({
  steps,
  currentStep,
  onStepClick,
}) => {
  return (
    <div className="wizard-stepper">
      {steps.map((step, index) => {
        const isActive = step.number === currentStep;
        const isCompleted = step.number < currentStep;
        const isClickable = onStepClick && step.number <= currentStep;

        return (
          <React.Fragment key={step.number}>
            <button
              className={`wizard-step ${isActive ? 'active' : ''} ${
                isCompleted ? 'completed' : ''
              }`}
              onClick={() => isClickable && onStepClick(step.number)}
              disabled={!isClickable}
              type="button"
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="step-number">
                {isCompleted ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                ) : (
                  step.number
                )}
              </span>
              <span className="step-label">{step.label}</span>
            </button>
            {index < steps.length - 1 && (
              <div className={`step-connector ${isCompleted ? 'completed' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default WizardStepper;
