/**
 * useFocusTrap — keep Tab inside a container while it is active.
 *
 * Any element that declares `aria-modal="true"` promises assistive tech that
 * the rest of the page is inert; without containment, Tab walks straight out
 * into the background and the promise is a lie. Shared by the design-system
 * dialogs (`ui/Modal`, `ui/ImagePreviewLightbox`) so the containment rule has
 * one implementation rather than one per dialog.
 *
 * Scope is deliberately narrow — Tab only. Esc-to-close, body scroll lock and
 * focus restore stay with the individual dialogs, which vary in how they want
 * to handle them (e.g. Modal's `blocking` mode ignores Esc).
 */

import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;

      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      // Focus escaped the container (or never entered it) — pull it back in
      // rather than letting Tab continue through the background.
      if (!container.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
        return;
      }

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [containerRef, active]);
}
