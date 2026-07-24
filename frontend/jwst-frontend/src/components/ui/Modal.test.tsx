/**
 * Modal — focus containment and Esc handling.
 *
 * Modal had no test coverage; these pin the behaviour that moved into the
 * shared `useFocusTrap` hook so a future change to the hook can't silently
 * regress the dialogs that depend on it.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Modal } from './Modal';

function renderModal(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <div>
      <button type="button">background action</button>
      <Modal
        open
        onClose={onClose}
        title="Export composite image"
        footer={
          <button type="button" name="confirm">
            Start export
          </button>
        }
        {...props}
      >
        body content
      </Modal>
    </div>
  );
  return { onClose };
}

describe('Modal', () => {
  it('cycles Tab between its own focusables and never reaches the page behind', async () => {
    renderModal();

    const close = screen.getByRole('button', { name: 'Close dialog' });
    const confirm = screen.getByRole('button', { name: 'Start export' });
    const background = screen.getByRole('button', { name: 'background action' });
    await waitFor(() => expect(close).toHaveFocus());

    // close -> confirm (last), then wraps back to close.
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();

    // Shift+Tab off the first element wraps to the last, not out of the dialog.
    await userEvent.tab({ shift: true });
    expect(confirm).toHaveFocus();
    expect(background).not.toHaveFocus();
  });

  it('closes on Esc', async () => {
    const { onClose } = renderModal();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores Esc while blocking', async () => {
    const { onClose } = renderModal({ blocking: true });
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});
