/**
 * Toasts — JWST Discovery design-system primitive.
 *
 * Wraps `sonner` with JWST token styling and sticky-by-default error/warning.
 *
 * Setup (one-time, in App.tsx or layout root):
 *
 *   import { ToastProvider } from '@/components/ui/toast';
 *
 *   <>
 *     <ToastProvider position="bottom-right" />
 *     <Router>…</Router>
 *   </>
 *
 * Usage anywhere:
 *
 *   import { toast } from '@/components/ui/toast';
 *   toast.success('Export complete', {
 *     description: 'Pillars of Creation · Hubble palette ready. 184 MB.',
 *     action: { label: 'Download', onClick: () => downloadComposite() },
 *   });
 *   toast.error('Processing failed', { description: 'MAST returned 504.' });
 *   toast.warning('Filter F187N missing');
 *   toast('New observations available'); // info
 *
 * Tones: default (info) · success · warning · error.
 * Info/success auto-dismiss at 5s; warning/error are sticky — use close button
 * or explicit `{ duration: 5000 }` in the options to override per callsite.
 */

import { Toaster, toast as sonnerToast } from 'sonner';
import './toast.css';

type ToastPosition =
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center';

interface ToastProviderProps {
  position?: ToastPosition;
}

export function ToastProvider({ position = 'top-right' }: ToastProviderProps = {}) {
  return (
    <Toaster
      position={position}
      offset={16}
      gap={8}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast: 'jwst-toast',
          title: 'jwst-toast-title',
          description: 'jwst-toast-description',
          actionButton: 'jwst-toast-action',
          closeButton: 'jwst-toast-close',
          success: 'jwst-toast-success',
          error: 'jwst-toast-error',
          warning: 'jwst-toast-warning',
          info: 'jwst-toast-info',
        },
        duration: 5000,
      }}
      closeButton
    />
  );
}

// Sonner's `toastOptions.duration` applies uniformly to every toast type, so
// we wrap `error` / `warning` here to default them to sticky. Without this the
// "Session expired" toast vanishes in 5s, losing the guarantee the old
// imperative AuthToast provided. Callsites can still pass an explicit
// `duration` in the options to override.
const stickyError: typeof sonnerToast.error = (message, data) =>
  sonnerToast.error(message, { duration: Infinity, ...data });
const stickyWarning: typeof sonnerToast.warning = (message, data) =>
  sonnerToast.warning(message, { duration: Infinity, ...data });

const callable = ((message, data) => sonnerToast(message, data)) as typeof sonnerToast;

// eslint-disable-next-line react-refresh/only-export-components -- the toast API is intentionally co-located with ToastProvider as a single primitive; splitting would fragment a cohesive unit
export const toast: typeof sonnerToast = Object.assign(callable, sonnerToast, {
  error: stickyError,
  warning: stickyWarning,
});
