import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FootprintPreview } from './FootprintPreview';
import type { FootprintResponse } from '../../types/MosaicTypes';

describe('FootprintPreview', () => {
  it('renders empty message when no footprints', () => {
    const emptyData: FootprintResponse = {
      footprints: [],
      bounding_box: { min_ra: 0, max_ra: 1, min_dec: 0, max_dec: 1 },
      n_files: 0,
    };
    const { container } = render(
      <FootprintPreview footprintData={emptyData} selectedImages={[]} />
    );
    expect(container.textContent).toContain('No WCS data found');
  });

  it('renders SVG with footprints when data is provided', () => {
    const data: FootprintResponse = {
      footprints: [
        {
          file_path: '/data/test.fits',
          center_ra: 10,
          center_dec: 20,
          corners_ra: [9, 11, 11, 9],
          corners_dec: [19, 19, 21, 21],
        },
      ],
      bounding_box: { min_ra: 9, max_ra: 11, min_dec: 19, max_dec: 21 },
      n_files: 1,
    };
    const { container } = render(<FootprintPreview footprintData={data} selectedImages={[]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute('aria-label')).toContain('WCS footprint preview');
  });
});
