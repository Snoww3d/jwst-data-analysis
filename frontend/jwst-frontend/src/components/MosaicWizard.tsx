import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { JwstDataModel } from '../types/JwstDataTypes';
import { FootprintResponse, MosaicWizardStep } from '../types/MosaicTypes';
import * as mosaicService from '../services/mosaicService';
import WizardStepper from './wizard/WizardStepper';
import MosaicSelectStep from './wizard/MosaicSelectStep';
import MosaicPreviewStep from './wizard/MosaicPreviewStep';
import type { MosaicPreviewStepHandle, MosaicFooterState } from './wizard/MosaicPreviewStep';
import './MosaicWizard.css';

interface MosaicWizardProps {
  allImages: JwstDataModel[];
  initialSelection?: string[];
  onMosaicSaved?: () => void;
  onClose: () => void;
}

const WIZARD_STEPS = [
  { number: 1, label: 'Select Files' },
  { number: 2, label: 'Preview & Export' },
];

const FOOTPRINT_DEBOUNCE_MS = 500;

/**
 * WCS Mosaic Creator wizard modal — thin shell orchestrating step components
 */
export const MosaicWizard: React.FC<MosaicWizardProps> = ({
  allImages,
  initialSelection,
  onMosaicSaved,
  onClose,
}) => {
  const [currentStep, setCurrentStep] = useState<MosaicWizardStep>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelection ?? [])
  );

  // Defer data refresh until wizard closes (calling onMosaicSaved immediately
  // triggers fetchData → setLoading(true) which unmounts the entire dashboard)
  const needsRefreshRef = useRef(false);
  const handleMosaicSaved = useCallback(() => {
    needsRefreshRef.current = true;
  }, []);
  const handleClose = useCallback(() => {
    onClose();
    if (needsRefreshRef.current) {
      onMosaicSaved?.();
    }
  }, [onClose, onMosaicSaved]);

  // Step 2 footer state (from MosaicPreviewStep)
  const previewRef = useRef<MosaicPreviewStepHandle>(null);
  const [previewFooter, setPreviewFooter] = useState<MosaicFooterState>({
    generating: false,
    hasResult: false,
    canGenerate: true,
  });

  // Footprint state (shared between steps)
  const [footprintData, setFootprintData] = useState<FootprintResponse | null>(null);
  const [footprintLoading, setFootprintLoading] = useState(false);
  const [footprintError, setFootprintError] = useState<string | null>(null);

  const footprintAbortRef = useRef<AbortController | null>(null);
  const footprintDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const selectedImages = useMemo(
    () =>
      selectedIdList
        .map((id) => allImages.find((img) => img.id === id))
        .filter((img): img is JwstDataModel => img !== undefined),
    [allImages, selectedIdList]
  );

  // Load footprints (called immediately or debounced)
  const loadFootprints = useCallback(
    async (ids?: string[]) => {
      const idsToUse = ids ?? selectedIdList;
      if (idsToUse.length < 2) {
        setFootprintData(null);
        return;
      }

      setFootprintLoading(true);
      setFootprintError(null);
      setFootprintData(null);

      footprintAbortRef.current?.abort();
      const controller = new AbortController();
      footprintAbortRef.current = controller;

      try {
        const data = await mosaicService.getFootprints(idsToUse, controller.signal);
        setFootprintData(data);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setFootprintError(err instanceof Error ? err.message : 'Failed to load footprints');
      } finally {
        setFootprintLoading(false);
        if (footprintAbortRef.current === controller) {
          footprintAbortRef.current = null;
        }
      }
    },
    [selectedIdList]
  );

  // Debounced footprint load when selection changes (for inline preview in step 1)
  useEffect(() => {
    // Clear stale data on selection change
    setFootprintData(null);
    setFootprintError(null);

    if (selectedIdList.length < 2) return;

    if (footprintDebounceRef.current) {
      clearTimeout(footprintDebounceRef.current);
    }
    footprintDebounceRef.current = setTimeout(() => {
      loadFootprints(selectedIdList);
    }, FOOTPRINT_DEBOUNCE_MS);

    return () => {
      if (footprintDebounceRef.current) {
        clearTimeout(footprintDebounceRef.current);
      }
    };
  }, [selectedIdList, loadFootprints]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      footprintAbortRef.current?.abort();
      if (footprintDebounceRef.current) {
        clearTimeout(footprintDebounceRef.current);
      }
    },
    []
  );

  // Close on Escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleClose]);

  // Navigation
  const canProceedToStep2 = selectedIds.size >= 2;

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
    if (e.target === e.currentTarget) handleClose();
  };

  const handleRetryFootprints = useCallback(() => {
    loadFootprints();
  }, [loadFootprints]);

  return (
    <div className="mosaic-wizard-backdrop" onClick={handleBackdropClick}>
      <div className="mosaic-wizard-modal">
        <header className="wizard-header">
          <h2 className="wizard-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="2" y="2" width="9" height="9" rx="1" opacity="0.7" fill="#4488ff" />
              <rect x="13" y="2" width="9" height="9" rx="1" opacity="0.7" fill="#44ddff" />
              <rect x="2" y="13" width="9" height="9" rx="1" opacity="0.7" fill="#8844ff" />
              <rect x="13" y="13" width="9" height="9" rx="1" opacity="0.7" fill="#44ff88" />
            </svg>
            WCS Mosaic Creator
          </h2>
          <WizardStepper
            steps={WIZARD_STEPS}
            currentStep={currentStep}
            onStepClick={handleStepClick}
          />
          <button
            className="btn-close"
            onClick={handleClose}
            aria-label="Close wizard"
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        <main className="wizard-content">
          {currentStep === 1 && (
            <MosaicSelectStep
              allImages={allImages}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              initialSelection={initialSelection}
              footprintData={footprintData}
              footprintLoading={footprintLoading}
              footprintError={footprintError}
              onRetryFootprints={handleRetryFootprints}
            />
          )}
          {currentStep === 2 && (
            <MosaicPreviewStep
              ref={previewRef}
              selectedImages={selectedImages}
              selectedIds={selectedIdList}
              footprintData={footprintData}
              footprintLoading={footprintLoading}
              footprintError={footprintError}
              onRetryFootprints={handleRetryFootprints}
              onMosaicSaved={handleMosaicSaved}
              onFooterStateChange={setPreviewFooter}
            />
          )}
        </main>

        <footer className="wizard-footer">
          <button
            className="btn-wizard btn-secondary"
            onClick={handleBack}
            disabled={currentStep === 1}
            type="button"
          >
            Back
          </button>
          <div className="footer-spacer" />
          {currentStep === 1 && (
            <button
              className="btn-wizard btn-primary"
              onClick={handleNext}
              disabled={!canProceedToStep2}
              type="button"
            >
              Next
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          )}
          {currentStep === 2 && !previewFooter.hasResult && (
            <button
              className="btn-wizard btn-generate"
              onClick={() => previewRef.current?.generate()}
              disabled={!previewFooter.canGenerate}
              type="button"
            >
              {previewFooter.generating ? (
                <>
                  <div className="mosaic-spinner small" />
                  Generating...
                </>
              ) : (
                'Generate Mosaic'
              )}
            </button>
          )}
          {currentStep === 2 && previewFooter.hasResult && (
            <>
              <button
                className="btn-wizard btn-secondary"
                onClick={() => previewRef.current?.generate()}
                disabled={!previewFooter.canGenerate}
                type="button"
              >
                {previewFooter.generating ? (
                  <>
                    <div className="mosaic-spinner small" />
                    Regenerating...
                  </>
                ) : (
                  'Regenerate'
                )}
              </button>
              <button className="btn-wizard-close" onClick={handleClose} type="button">
                Close
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
};

export default MosaicWizard;
