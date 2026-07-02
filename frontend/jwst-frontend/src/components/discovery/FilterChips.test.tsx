import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterChips } from './FilterChips';

describe('FilterChips', () => {
  it('renders static chips plus one chip per data category', () => {
    render(<FilterChips categories={['nebula', 'galaxy']} active="all" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'All targets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Best potential' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nebulae' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Galaxies' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('title-cases unknown categories', () => {
    render(<FilterChips categories={['supernova remnant']} active="all" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Supernova remnant' })).toBeInTheDocument();
  });

  it('marks the active chip with aria-pressed', () => {
    render(<FilterChips categories={['nebula']} active="nebula" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Nebulae' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All targets' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('reports chip selection', () => {
    const onChange = vi.fn();
    render(<FilterChips categories={['nebula']} active="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Best potential' }));
    expect(onChange).toHaveBeenCalledWith('great');
    fireEvent.click(screen.getByRole('button', { name: 'Nebulae' }));
    expect(onChange).toHaveBeenCalledWith('nebula');
  });
});
