import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { JwstDataModel } from '../types/JwstDataTypes';
import { MosaicPageState } from '../types/CompositeTypes';
import { FootprintResponse, MosaicLimits, MosaicWizardStep } from '../types/MosaicTypes';
import { ApiError } from '../services/ApiError';
import { jwstDataService } from '../services';
import * as mosaicService from '../services/mosaicService';
import { getFitsFileInfo } from '../utils/fitsUtils';
import WizardStepper from '../components/wizard/WizardStepper';
import MosaicSelectStep from '../components/wizard/MosaicSelectStep';
import MosaicPreviewStep from '../components/wizard/MosaicPreviewStep';
import type {
  MosaicPreviewStepHandle,
  MosaicFooterState,
} from '../components/wizard/MosaicPreviewStep';
import '../components/CompositeWizard.css';

const WIZARD_STEPS = [
  { number: 1, label: 'Select Files' },
  { number: 2, label: 'Preview & Export' },
];

const FOOTPRINT_DEBOUNCE_MS = 500;

/**
 * WCS Mosaic Creator page — full-page version of the mosaic wizard.
 *
 * Supports initialization from:
 * - Library selection (initialSelection in router state)
 * - Direct URL navigation (empty selection)
 */
export function MosaicPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pageState = location.state as MosaicPageState | null;

  const [allImages, setAllImages] = useState<JwstDataModel[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch viewable images from the library
  useEffect(() => {
    let cancelled = false;
    async function fetchImages() {
      try {
        const data = await jwstDataService.getAll(true);
        if (cancelled) return;
        const viewable = data.filter((item) => {
          const fitsInfo = getFitsFileInfo(item.fileName);
          return fitsInfo.viewable && !item.isArchived;
        });

        if (pageState?.allImageIds && pageState.allImageIds.length > 0) {
          const idSet = new Set(pageState.allImageIds);
          setAllImages(viewable.filter((img) => idSet.has(img.id)));
        } else {
          setAllImages(viewable);
        }
      } catch {
        // Continue with empty list
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchImages();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [currentStep, setCurrentStep] = useState<MosaicWizardStep>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(pageState?.initialSelection ?? [])
  );

  // No-op — library will refetch on remount when user navigates back
  const handleMosaicSaved = useCallback(() => {}, []);

  const handleClose = useCallback(() => {
    navigate(-1);
    // Trigger library refresh if a mosaic was saved
    // (The library will refetch on mount anyway, so navigating back is sufficient)
  }, [navigate]);

  // Step 2 footer state
  const previewRef = useRef<MosaicPreviewStepHandle>(null);
  const [previewFooter, setPreviewFooter] = useState<MosaicFooterState>({
    generating: false,
    hasResult: false,
    canGenerate: true,
  });

  // Processing limits
  const [limits, setLimits] = useState<MosaicLimits | null>(null);

  useEffect(() => {
    let cancelled = false;
    mosaicService
      .getLimits()
      .then((data) => {
        if (!cancelled) setLimits(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Footprint state
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

        let errorMessage = 'Failed to load footprints';
        if (ApiError.isApiError(err)) {
          errorMessage = err.status === 413 ? err.message : err.details || err.message;
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }
        setFootprintError(errorMessage);
      } finally {
        setFootprintLoading(false);
        if (footprintAbortRef.current === controller) {
          footprintAbortRef.current = null;
        }
      }
    },
    [selectedIdList]
  );

  // Clear stale footprint data on selection change
  const [prevSelectedIdList, setPrevSelectedIdList] = useState(selectedIdList);
  if (selectedIdList !== prevSelectedIdList) {
    setPrevSelectedIdList(selectedIdList);
    setFootprintData(null);
    setFootprintError(null);
  }

  // Debounced footprint load
  useEffect(() => {
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

  const handleRetryFootprints = useCallback(() => {
    loadFootprints();
  }, [loadFootprints]);

  if (loading) {
    return (
      <div className="wizard-page">
        <div className="wizard-page-loading">Loading images...</div>
      </div>
    );
  }

  return (
    <div className="wizard-page">
      <div className="wizard-page-container">
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
            className="btn-base btn-close"
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
              initialSelection={pageState?.initialSelection}
              maxFileSizeBytes={limits ? limits.mosaicMaxFileSizeMB * 1024 * 1024 : null}
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
            className="btn-base btn-wizard btn-secondary"
            onClick={handleBack}
            disabled={currentStep === 1}
            type="button"
          >
            Back
          </button>
          <div className="footer-spacer" />
          {currentStep === 1 && (
            <button
              className="btn-base btn-wizard btn-primary"
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
              className="btn-base btn-wizard btn-generate"
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
                className="btn-base btn-wizard btn-secondary"
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
              <button className="btn-base btn-wizard-close" onClick={handleClose} type="button">
                Close
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
