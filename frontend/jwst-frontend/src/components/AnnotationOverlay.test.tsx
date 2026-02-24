import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import AnnotationOverlay from './AnnotationOverlay';
import type { Annotation, AnnotationToolType, AnnotationColor } from '../types/AnnotationTypes';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

describe('AnnotationOverlay', () => {
  const defaultProps = {
    activeTool: null as AnnotationToolType | null,
    annotations: [] as Annotation[],
    activeColor: '#ffffff' as AnnotationColor,
    onAnnotationAdd: vi.fn<(annotation: Annotation) => void>(),
    onAnnotationSelect: vi.fn<(id: string | null) => void>(),
    imageDataWidth: 1024,
    imageDataHeight: 1024,
    imageElement: null as HTMLImageElement | null,
  };

  it('renders nothing when no tool active and no annotations', () => {
    const { container } = render(<AnnotationOverlay {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders SVG overlay when tool is active', () => {
    const { container } = render(<AnnotationOverlay {...defaultProps} activeTool="arrow" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.classList.contains('annotation-overlay')).toBe(true);
  });

  it('renders SVG overlay when annotations exist', () => {
    const annotations: Annotation[] = [
      {
        type: 'text',
        id: 'ann-1',
        x: 100,
        y: 100,
        text: 'Test',
        fontSize: 14,
        color: '#ffffff',
        selected: false,
      },
    ];
    const { container } = render(<AnnotationOverlay {...defaultProps} annotations={annotations} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
