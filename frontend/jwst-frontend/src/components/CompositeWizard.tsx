import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { JwstDataModel } from '../types/JwstDataTypes';
import { WizardStep, NChannelState, createDefaultRGBChannels } from '../types/CompositeTypes';
import { autoAssignNChannels } from '../utils/wavelengthUtils';
import { getFootprints } from '../services/mosaicService';
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

/** Debounce delay for overlap checks while user is assigning channels */
const OVERLAP_CHECK_DEBOUNCE_MS = 800;

/**
 * Composite Creator wizard modal — supports N dynamic channels with user-assignable colors
 */
export const CompositeWizard: React.FC<CompositeWizardProps> = ({
  allImages,
  initialSelection = [],
  onClose,
}) => {
  // If 3+ images were pre-selected, auto-assign by filter; otherwise default to 3 RGB channels
  const computeInitialChannels = (): NChannelState[] => {
    if (initialSelection.length >= 3) {
      const preSelected = initialSelection
        .map((id) => allImages.find((img) => img.id === id))
        .filter((img): img is JwstDataModel => img !== undefined);
      if (preSelected.length >= 3) {
        try {
          return autoAssignNChannels(preSelected);
        } catch {
          // Fall through to default if auto-assign fails
        }
      }
    }
    return createDefaultRGBChannels();
  };

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [channels, setChannels] = useState<NChannelState[]>(computeInitialChannels);
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [overlapDismissed, setOverlapDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive selectedImages from all channels' dataIds
  const selectedImages = useMemo(() => {
    const allIds = channels.flatMap((ch) => ch.dataIds);
    const uniqueIds = [...new Set(allIds)];
    return uniqueIds
      .map((id) => allImages.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);
  }, [channels, allImages]);

  // Unique sorted data IDs for overlap check dependency
  const assignedDataIds = useMemo(() => {
    const ids = channels.flatMap((ch) => ch.dataIds);
    return [...new Set(ids)].sort().join(',');
  }, [channels]);

  // At least 1 channel must have at least 1 image to proceed
  const canProceedToStep2 = channels.some((ch) => ch.dataIds.length > 0);

  /** Check overlap for given data IDs */
  const checkOverlap = useCallback(async (dataIdsCsv: string) => {
    const dataIds = dataIdsCsv ? dataIdsCsv.split(',') : [];
    if (dataIds.length < 2) {
      setOverlapWarning(null);
      return;
    }

    // Cancel any in-flight check
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await getFootprints(dataIds, controller.signal);
      if (!controller.signal.aborted) {
        const warning = response.overlap_warning ?? null;
        setOverlapWarning(warning);
        if (warning) setOverlapDismissed(false);
      }
    } catch {
      // Non-critical — don't block the wizard if footprint check fails.
      // AbortError from channel changes is expected and harmless.
    }
  }, []);

  // Debounced overlap check when channel assignments change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      void checkOverlap(assignedDataIds);
    }, OVERLAP_CHECK_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [assignedDataIds, checkOverlap]);

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
            Composite Creator
          </h2>
          <WizardStepper
            steps={WIZARD_STEPS}
            currentStep={currentStep}
            onStepClick={handleStepClick}
          />
          <button
            className="btn-base btn-icon btn-close"
            onClick={onClose}
            aria-label="Close wizard"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        <main className="wizard-content">
          {overlapWarning && !overlapDismissed && (
            <div className="overlap-warning-banner" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
              </svg>
              <div className="overlap-warning-text">
                {overlapWarning.split('\n').map((line, i) =>
                  i === 0 ? (
                    <p key={line} className="overlap-warning-summary">
                      {line}
                    </p>
                  ) : (
                    <p key={line} className="overlap-warning-group">
                      {line}
                    </p>
                  )
                )}
              </div>
              <button
                className="btn-base btn-icon overlap-warning-dismiss"
                onClick={() => setOverlapDismissed(true)}
                aria-label="Dismiss warning"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          )}
          {currentStep === 1 && (
            <ChannelAssignStep
              allImages={allImages}
              channels={channels}
              onChannelsChange={setChannels}
            />
          )}
          {currentStep === 2 && (
            <CompositePreviewStep
              selectedImages={selectedImages}
              channels={channels}
              onChannelsChange={setChannels}
              onExportComplete={onClose}
            />
          )}
        </main>

        <footer className="wizard-footer">
          <button
            className="btn-base btn-wizard btn-secondary"
            onClick={handleBack}
            disabled={currentStep === 1}
          >
            Back
          </button>
          <div className="footer-spacer" />
          {currentStep === 1 ? (
            <button
              className="btn-base btn-wizard btn-primary"
              onClick={handleNext}
              disabled={!canProceedToStep2}
            >
              Next
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          ) : (
            <button className="btn-base btn-wizard btn-success" onClick={onClose}>
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};

export default CompositeWizard;
