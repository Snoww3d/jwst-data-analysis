import React, { useState, useCallback } from 'react';
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
import ImageSelectionStep from './wizard/ImageSelectionStep';
import ChannelAssignmentStep from './wizard/ChannelAssignmentStep';
import CompositePreviewStep from './wizard/CompositePreviewStep';
import './CompositeWizard.css';

interface CompositeWizardProps {
  allImages: JwstDataModel[];
  initialSelection?: string[];
  onClose: () => void;
}

const WIZARD_STEPS = [
  { number: 1, label: 'Select Images' },
  { number: 2, label: 'Assign Channels' },
  { number: 3, label: 'Export' },
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

  const [currentStep, setCurrentStep] = useState<WizardStep>(initialSelection.length >= 3 ? 2 : 1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelection));
  const [channelAssignment, setChannelAssignment] = useState<ChannelAssignment>({
    ...DEFAULT_CHANNEL_ASSIGNMENT,
  });
  const [channelParams, setChannelParams] = useState<ChannelParams>(createDefaultChannelParams);

  // Get selected images as array
  const selectedImages = Array.from(selectedIds)
    .map((id) => allImages.find((img) => img.id === id))
    .filter((img): img is JwstDataModel => img !== undefined);

  // Initialize channel assignment when selection changes
  const handleSelectionChange = useCallback(
    (ids: Set<string>) => {
      setSelectedIds(ids);

      // If we have exactly 3 images, auto-sort them
      if (ids.size >= 3) {
        const images = Array.from(ids)
          .map((id) => allImages.find((img) => img.id === id))
          .filter((img): img is JwstDataModel => img !== undefined);

        const sorted = autoSortByWavelength(images);
        setChannelAssignment(sorted);

        // Initialize per-channel params to defaults (channels can share the same image).
        setChannelParams(createDefaultChannelParams());
      }
    },
    [allImages]
  );

  const canProceedToStep2 = selectedIds.size >= 3;
  const canProceedToStep3 =
    channelAssignment.red.length > 0 &&
    channelAssignment.green.length > 0 &&
    channelAssignment.blue.length > 0;

  const handleNext = () => {
    if (currentStep === 1 && canProceedToStep2) {
      setCurrentStep(2);
    } else if (currentStep === 2 && canProceedToStep3) {
      setCurrentStep(3);
    }
  };

  const handleBack = () => {
    if (currentStep === 2) {
      setCurrentStep(1);
    } else if (currentStep === 3) {
      setCurrentStep(2);
    }
  };

  const handleStepClick = (step: number) => {
    if (step === 1) {
      setCurrentStep(1);
    } else if (step === 2 && canProceedToStep2) {
      setCurrentStep(2);
    } else if (step === 3 && canProceedToStep3) {
      setCurrentStep(3);
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="8" cy="8" r="4" fill="#ff4444" />
              <circle cx="16" cy="8" r="4" fill="#44ff44" />
              <circle cx="12" cy="14" r="4" fill="#4488ff" />
            </svg>
            RGB Composite Creator
          </h2>
          <button className="btn-close" onClick={onClose} aria-label="Close wizard">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        <WizardStepper
          steps={WIZARD_STEPS}
          currentStep={currentStep}
          onStepClick={handleStepClick}
        />

        <main className="wizard-content">
          {currentStep === 1 && (
            <ImageSelectionStep
              allImages={allImages}
              selectedIds={selectedIds}
              onSelectionChange={handleSelectionChange}
            />
          )}
          {currentStep === 2 && (
            <ChannelAssignmentStep
              selectedImages={selectedImages}
              channelAssignment={channelAssignment}
              channelParams={channelParams}
              onChannelAssignmentChange={setChannelAssignment}
              onChannelParamsChange={setChannelParams}
            />
          )}
          {currentStep === 3 && (
            <CompositePreviewStep
              selectedImages={selectedImages}
              channelAssignment={channelAssignment}
              channelParams={channelParams}
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
          {currentStep < 3 ? (
            <button
              className="btn-wizard btn-primary"
              onClick={handleNext}
              disabled={
                (currentStep === 1 && !canProceedToStep2) ||
                (currentStep === 2 && !canProceedToStep3)
              }
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
