/**
 * ImagePreviewLightbox — focus containment.
 *
 * The lightbox declares `aria-modal="true"`, which tells assistive tech the
 * background is inert. Tab must therefore stay inside the dialog; without a
 * trap the promise is a lie and keyboard focus walks into the page behind the
 * backdrop.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImagePreviewLightbox } from './ImagePreviewLightbox';

function renderLightbox() {
  return render(
    <div>
      <button type="button">background action</button>
      <ImagePreviewLightbox
        open
        title="jw001_i2d.fits"
        onClose={vi.fn()}
        loadImage={() => Promise.resolve(new Blob(['png'], { type: 'image/png' }))}
      />
    </div>
  );
}

describe('ImagePreviewLightbox focus trap', () => {
  beforeEach(() => {
    // jsdom has no object-URL support.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('moves focus to the close button on open', async () => {
    renderLightbox();
    const close = await screen.findByRole('button', { name: 'Close preview' });
    await waitFor(() => expect(close).toHaveFocus());
  });

  it('keeps Tab inside the dialog instead of reaching the page behind it', async () => {
    renderLightbox();
    const close = await screen.findByRole('button', { name: 'Close preview' });
    await waitFor(() => expect(close).toHaveFocus());

    await userEvent.tab();

    expect(screen.getByRole('button', { name: 'background action' })).not.toHaveFocus();
    expect(close).toHaveFocus();
  });

  it('keeps Shift+Tab inside the dialog', async () => {
    renderLightbox();
    const close = await screen.findByRole('button', { name: 'Close preview' });
    await waitFor(() => expect(close).toHaveFocus());

    await userEvent.tab({ shift: true });

    expect(screen.getByRole('button', { name: 'background action' })).not.toHaveFocus();
    expect(close).toHaveFocus();
  });
});
