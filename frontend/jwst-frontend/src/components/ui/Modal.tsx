/**
 * Modal — JWST Discovery design-system primitive.
 *
 * Usage:
 *   <Modal
 *     open={showExportDialog}
 *     onClose={() => setShowExportDialog(false)}
 *     title="Export composite image"
 *     destructive={false}
 *     footer={
 *       <>
 *         <button className="btn-base btn-standard modal-btn-ghost" onClick={close}>Cancel</button>
 *         <button className="btn-base btn-standard modal-btn-primary" onClick={start}>Start export</button>
 *       </>
 *     }
 *   >
 *     Render the Hubble-palette recipe at full resolution…
 *   </Modal>
 *
 * Closes on Esc, backdrop click, and the ✕ button.
 * Traps focus inside the modal while open.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 3-px red header rail for destructive actions. */
  destructive?: boolean;
  /** Width preset. Default 'md' = 480px. */
  size?: 'sm' | 'md' | 'lg';
  /** Prevent close on backdrop click / Esc (e.g. during in-flight jobs). */
  blocking?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  destructive = false,
  size = 'md',
  blocking = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Esc to close + focus trap + body scroll lock.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first focusable element in the dialog.
    requestAnimationFrame(() => {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusables?.[0]?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !blocking) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = originalOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose, blocking]);

  if (!open) return null;

  const onBackdropClick = () => {
    if (!blocking) onClose();
  };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onBackdropClick} role="presentation">
      <div
        ref={dialogRef}
        className={`modal modal-${size}${destructive ? ' modal-destructive' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3 id={titleId} className="modal-title">
            {title}
          </h3>
          {!blocking && (
            <button
              type="button"
              className="btn-base modal-close"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
