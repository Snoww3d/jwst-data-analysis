/**
 * ImagePreviewLightbox — JWST Discovery design-system primitive.
 *
 * A lightweight, full-bleed image lightbox for ephemeral previews (e.g. a
 * calibration-run output rendered on the fly). Deliberately NOT the full
 * ImageViewer: no library ObjectId, no cube/pixel/histogram machinery — just a
 * zoomable, pannable image with Esc / backdrop / ✕ to close.
 *
 * Auth-aware previews can't use a bare <img src> (the endpoint requires a bearer
 * token), so the caller supplies `loadImage`, which fetches the bytes as a Blob;
 * this component owns the object-URL lifecycle (create on load, revoke on close).
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent, type WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { toast } from './toast';
import './ImagePreviewLightbox.css';

interface ImagePreviewLightboxProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Fetches the image bytes (auth-aware). Memoize in the parent so a change
   *  in the source — not every render — triggers a refetch. */
  loadImage: () => Promise<Blob>;
}

export function ImagePreviewLightbox({
  open,
  title,
  onClose,
  loadImage,
}: ImagePreviewLightboxProps) {
  const [url, setUrl] = useState<string | null>(null);
  // Starts true: the component is mounted per-open (parent keys it by output),
  // so it always begins in the loading state — no synchronous reset in-effect.
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const closeBtnRef = useRef<globalThis.HTMLButtonElement>(null);

  // Fetch the image when opened. Owns the object-URL lifecycle: revoke on
  // cleanup to avoid leaks. setState only runs async (in the promise handlers),
  // never synchronously in the effect body.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    loadImage()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Preview failed', {
          description: 'Could not render this output. It may not be a viewable image.',
        });
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, loadImage, onClose]);

  // Esc to close + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = originalOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  const handleWheel = useCallback((e: WheelEvent) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(0.1, Math.min(10, s * delta)));
  }, []);

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    setOffset({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y });
  };

  const stopDragging = () => setIsDragging(false);

  if (!open) return null;

  return createPortal(
    <div
      className="preview-lightbox-backdrop"
      onMouseDown={onClose}
      role="presentation"
      onWheel={handleWheel}
    >
      <div
        className="preview-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="preview-lightbox-header">
          <span className="preview-lightbox-title" title={title}>
            {title}
          </span>
          <button
            ref={closeBtnRef}
            type="button"
            className="btn-base preview-lightbox-close"
            onClick={onClose}
            aria-label="Close preview"
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
        </header>
        <div
          className="preview-lightbox-stage"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          {loading && <div className="spinner" aria-label="Loading preview" />}
          {url && (
            <img
              src={url}
              alt={title}
              className="preview-lightbox-image"
              draggable={false}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
