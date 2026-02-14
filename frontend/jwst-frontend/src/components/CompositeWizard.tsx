import React, { useState, useMemo } from 'react';
import { JwstDataModel } from '../types/JwstDataTypes';
import {
  WizardStep,
  ChannelAssignment,
  ChannelParams,
  DEFAULT_CHANNEL_ASSIGNMENT,
  DEFAULT_CHANNEL_PARAMS_BY_CHANNEL,
} from '../types/CompositeTypes';
import { autoSortByWavelength } from '../utils/wavelengthUtils';
import WizardStepper from './wizard/WizardStepper';
import ChannelAssignStep from './wizard/ChannelAssignStep';
import CompositePreviewStep from './wizard/CompositePreviewStep';
import './CompositeWizard.css';

interface CompositeWizardProps {
  allImages: JwstDataModel[];
  initialSelection?: string[];
  onClose: () => void;
}

const WIZARD_STEPS = [
  { number: 1, label: 'Assign Channels' },
  { number: 2, label: 'Preview & Export' },
];

/**
 * RGB Composite Creator wizard modal
 */
export const CompositeWizard: React.FC<CompositeWizardProps> = ({
  allImages,
  initialSelection = [],
  onClose,
}) => {
  const createDefaultChannelParams = (): ChannelParams => ({
    red: { ...DEFAULT_CHANNEL_PARAMS_BY_CHANNEL.red },
    green: { ...DEFAULT_CHANNEL_PARAMS_BY_CHANNEL.green },
    blue: { ...DEFAULT_CHANNEL_PARAMS_BY_CHANNEL.blue },
  });

  // If 3+ images were pre-selected on the dashboard, auto-sort them into channels
  const computeInitialAssignment = (): ChannelAssignment => {
    if (initialSelection.length >= 3) {
      const preSelected = initialSelection
        .map((id) => allImages.find((img) => img.id === id))
        .filter((img): img is JwstDataModel => img !== undefined);
      if (preSelected.length >= 3) {
        try {
          return autoSortByWavelength(preSelected);
        } catch {
          // Fall through to default if sort fails
        }
      }
    }
    return { ...DEFAULT_CHANNEL_ASSIGNMENT };
  };

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [channelAssignment, setChannelAssignment] =
    useState<ChannelAssignment>(computeInitialAssignment);
  const [channelParams, setChannelParams] = useState<ChannelParams>(createDefaultChannelParams);

  // Derive selectedImages from channelAssignment (all IDs across all 3 channels)
  const selectedImages = useMemo(() => {
    const allIds = [
      ...channelAssignment.red,
      ...channelAssignment.green,
      ...channelAssignment.blue,
    ];
    const uniqueIds = [...new Set(allIds)];
    return uniqueIds
      .map((id) => allImages.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);
  }, [channelAssignment, allImages]);

  const canProceedToStep2 =
    channelAssignment.red.length > 0 &&
    channelAssignment.green.length > 0 &&
    channelAssignment.blue.length > 0;

  const handleNext = () => {
    if (currentStep === 1 && canProceedToStep2) {
      setCurrentStep(2);
    }
  };

  const handleBack = () => {
    if (currentStep === 2) {
      setCurrentStep(1);
    }
  };

  const handleStepClick = (step: number) => {
    if (step === 1) {
      setCurrentStep(1);
    } else if (step === 2 && canProceedToStep2) {
      setCurrentStep(2);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="composite-wizard-backdrop" onClick={handleBackdropClick}>
      <div className="composite-wizard-modal">
        <header className="wizard-header">
          <h2 className="wizard-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="8" cy="8" r="4" fill="#ff4444" />
              <circle cx="16" cy="8" r="4" fill="#44ff44" />
              <circle cx="12" cy="14" r="4" fill="#4488ff" />
            </svg>
            RGB Composite
          </h2>
          <WizardStepper
            steps={WIZARD_STEPS}
            currentStep={currentStep}
            onStepClick={handleStepClick}
          />
          <button className="btn-close" onClick={onClose} aria-label="Close wizard">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        <main className="wizard-content">
          {currentStep === 1 && (
            <ChannelAssignStep
              allImages={allImages}
              channelAssignment={channelAssignment}
              onChannelAssignmentChange={setChannelAssignment}
            />
          )}
          {currentStep === 2 && (
            <CompositePreviewStep
              selectedImages={selectedImages}
              channelAssignment={channelAssignment}
              onChannelAssignmentChange={setChannelAssignment}
              channelParams={channelParams}
              onChannelParamsChange={setChannelParams}
              onExportComplete={onClose}
            />
          )}
        </main>

        <footer className="wizard-footer">
          <button
            className="btn-wizard btn-secondary"
            onClick={handleBack}
            disabled={currentStep === 1}
          >
            Back
          </button>
          <div className="footer-spacer" />
          {currentStep === 1 ? (
            <button
              className="btn-wizard btn-primary"
              onClick={handleNext}
              disabled={!canProceedToStep2}
            >
              Next
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          ) : (
            <button className="btn-wizard btn-success" onClick={onClose}>
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

export default CompositeWizard;
