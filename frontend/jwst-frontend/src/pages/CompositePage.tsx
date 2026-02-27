import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { JwstDataModel } from '../types/JwstDataTypes';
import {
  WizardStep,
  NChannelState,
  CompositePageState,
  createDefaultRGBChannels,
} from '../types/CompositeTypes';
import { autoAssignNChannels } from '../utils/wavelengthUtils';
import { jwstDataService } from '../services';
import { getFitsFileInfo } from '../utils/fitsUtils';
import WizardStepper from '../components/wizard/WizardStepper';
import ChannelAssignStep from '../components/wizard/ChannelAssignStep';
import CompositePreviewStep from '../components/wizard/CompositePreviewStep';
import '../components/CompositeWizard.css';
import './CompositePage.css';

const WIZARD_STEPS = [
  { number: 1, label: 'Assign Channels' },
  { number: 2, label: 'Preview & Export' },
];

/**
 * Compute initial channels based on page state and available images.
 */
function computeChannels(
  pageState: CompositePageState | null,
  images: JwstDataModel[]
): NChannelState[] {
  // Path 1: Pre-built channels from guided create
  if (pageState?.initialChannels && pageState.initialChannels.length > 0) {
    return pageState.initialChannels;
  }

  // Path 2: Pre-selected image IDs from library
  if (pageState?.initialSelection && pageState.initialSelection.length >= 3 && images.length > 0) {
    const preSelected = pageState.initialSelection
      .map((id) => images.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);
    if (preSelected.length >= 3) {
      try {
        return autoAssignNChannels(preSelected);
      } catch {
        // Fall through to default
      }
    }
  }

  // Path 3: Default RGB channels
  return createDefaultRGBChannels();
}

/**
 * Composite Creator page — full-page version of the composite wizard.
 *
 * Supports initialization from:
 * - Guided create flow (initialChannels in router state)
 * - Library selection (initialSelection in router state)
 * - Direct URL navigation (default RGB channels)
 */
export function CompositePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pageState = location.state as CompositePageState | null;
  const pageStateRef = useRef(pageState);

  const [allImages, setAllImages] = useState<JwstDataModel[]>([]);
  const [channels, setChannels] = useState<NChannelState[]>(() => computeChannels(pageState, []));
  const [loading, setLoading] = useState(true);

  // Fetch viewable images and compute channels
  useEffect(() => {
    let cancelled = false;
    async function fetchImages() {
      try {
        const data = await jwstDataService.getAll(true);
        if (cancelled) return;
        let viewable = data.filter((item) => {
          const fitsInfo = getFitsFileInfo(item.fileName);
          return fitsInfo.viewable && !item.isArchived;
        });

        // Filter to specific IDs if provided
        const ps = pageStateRef.current;
        if (ps?.allImageIds && ps.allImageIds.length > 0) {
          const idSet = new Set(ps.allImageIds);
          viewable = viewable.filter((img) => idSet.has(img.id));
        }

        setAllImages(viewable);
        setChannels(computeChannels(ps, viewable));
      } catch {
        // Continue with empty image list — user can still navigate back
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchImages();
    return () => {
      cancelled = true;
    };
  }, []);

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // Derive selectedImages from all channels' dataIds
  const selectedImages = useMemo(() => {
    const allIds = channels.flatMap((ch) => ch.dataIds);
    const uniqueIds = [...new Set(allIds)];
    return uniqueIds
      .map((id) => allImages.find((img) => img.id === id))
      .filter((img): img is JwstDataModel => img !== undefined);
  }, [channels, allImages]);

  const canProceedToStep2 = channels.some((ch) => ch.dataIds.length > 0);

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

  const handleClose = () => {
    navigate(-1);
  };

  if (loading) {
    return (
      <div className="composite-page">
        <div className="composite-page-loading">Loading images...</div>
      </div>
    );
  }

  return (
    <div className="composite-page">
      <div className="composite-page-container">
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
          <button className="btn-close" onClick={handleClose} aria-label="Close wizard">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        <main className="wizard-content">
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
              onExportComplete={handleClose}
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
            <button className="btn-wizard btn-success" onClick={handleClose}>
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
