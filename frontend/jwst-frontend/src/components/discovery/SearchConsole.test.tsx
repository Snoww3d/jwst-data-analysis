import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SearchConsole } from './SearchConsole';

function renderConsole(query = '', onQueryChange = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<SearchConsole query={query} onQueryChange={onQueryChange} />} />
        <Route path="/target/:name" element={<div data-testid="target-page" />} />
      </Routes>
    </MemoryRouter>
  );
  return onQueryChange;
}

describe('SearchConsole', () => {
  it('renders headline, input, and example chips', () => {
    renderConsole();
    expect(
      screen.getByRole('heading', { name: /explore the universe through webb/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PID 2739' })).toBeInTheDocument();
  });

  it('propagates typing to onQueryChange', () => {
    const onQueryChange = renderConsole();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'M16' } });
    expect(onQueryChange).toHaveBeenCalledWith('M16');
  });

  it('populates the query when an example chip is clicked', () => {
    const onQueryChange = renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'NGC 3324' }));
    expect(onQueryChange).toHaveBeenCalledWith('NGC 3324');
  });

  it('disables the search button for queries under 2 characters', () => {
    renderConsole('M');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('navigates to the target page on submit', () => {
    renderConsole('Carina Nebula');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByTestId('target-page')).toBeInTheDocument();
  });
});
