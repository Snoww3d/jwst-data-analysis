import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  TelescopeIcon,
  ImageIcon,
  TableIcon,
  CheckIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
  ArchiveIcon,
  LineageIcon,
} from './DashboardIcons';

describe('DashboardIcons', () => {
  it('TelescopeIcon renders an SVG element', () => {
    const { container } = render(<TelescopeIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('ImageIcon renders an SVG element', () => {
    const { container } = render(<ImageIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('TableIcon renders an SVG element', () => {
    const { container } = render(<TableIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('CheckIcon renders an SVG element', () => {
    const { container } = render(<CheckIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('PlusIcon renders an SVG element', () => {
    const { container } = render(<PlusIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('TargetIcon renders an SVG element', () => {
    const { container } = render(<TargetIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('TrashIcon renders an SVG element', () => {
    const { container } = render(<TrashIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('ArchiveIcon renders an SVG element', () => {
    const { container } = render(<ArchiveIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('LineageIcon renders an SVG element', () => {
    const { container } = render(<LineageIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('TelescopeIcon accepts and applies size prop', () => {
    const { container } = render(<TelescopeIcon size={32} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('TelescopeIcon uses default size when not specified', () => {
    const { container } = render(<TelescopeIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '18');
    expect(svg).toHaveAttribute('height', '18');
  });

  it('ImageIcon uses default size of 14', () => {
    const { container } = render(<ImageIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '14');
    expect(svg).toHaveAttribute('height', '14');
  });

  it('icons accept className prop', () => {
    const { container } = render(<TelescopeIcon className="custom-class" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('custom-class');
  });

  it('all icons have viewBox attribute', () => {
    const { container } = render(
      <div>
        <TelescopeIcon />
        <ImageIcon />
        <TableIcon />
        <CheckIcon />
        <PlusIcon />
        <TargetIcon />
        <TrashIcon />
        <ArchiveIcon />
        <LineageIcon />
      </div>
    );
    const svgs = container.querySelectorAll('svg');
    svgs.forEach((svg) => {
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    });
  });
});
