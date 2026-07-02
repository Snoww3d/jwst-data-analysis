import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchForm from './SearchForm';

describe('SearchForm', () => {
  const baseProps = {
    searchType: 'target' as const,
    onSearchTypeChange: vi.fn(),
    targetName: '',
    onTargetNameChange: vi.fn(),
    ra: '',
    onRaChange: vi.fn(),
    dec: '',
    onDecChange: vi.fn(),
    radius: '0.2',
    onRadiusChange: vi.fn(),
    obsId: '',
    onObsIdChange: vi.fn(),
    programId: '',
    onProgramIdChange: vi.fn(),
    showAllCalibLevels: false,
    onShowAllCalibLevelsChange: vi.fn(),
    downloadSource: 'auto' as const,
    onDownloadSourceChange: vi.fn(),
    loading: false,
    onSearch: vi.fn(),
  };

  it('renders the target-name input when searchType is target', () => {
    render(<SearchForm {...baseProps} />);
    expect(
      screen.getByPlaceholderText('Target name (e.g., NGC 3132, Carina Nebula)')
    ).toBeInTheDocument();
  });

  it('renders RA/Dec inputs when searchType is coordinates', () => {
    render(<SearchForm {...baseProps} searchType="coordinates" />);
    expect(screen.getByPlaceholderText('RA (degrees)')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Dec (degrees)')).toBeInTheDocument();
  });

  it('renders the observation ID input when searchType is observation', () => {
    render(<SearchForm {...baseProps} searchType="observation" />);
    expect(
      screen.getByPlaceholderText('Observation ID (e.g., jw02729-o001_s00001)')
    ).toBeInTheDocument();
  });

  it('renders the program ID input when searchType is program', () => {
    render(<SearchForm {...baseProps} searchType="program" />);
    expect(screen.getByPlaceholderText('Program ID (e.g., 2729)')).toBeInTheDocument();
  });

  it('hides the calibration-level toggle for observation ID searches', () => {
    render(<SearchForm {...baseProps} searchType="observation" />);
    expect(screen.queryByText('Show all calibration levels')).not.toBeInTheDocument();
  });

  it('shows the calibration-level toggle for non-observation searches', () => {
    render(<SearchForm {...baseProps} />);
    expect(screen.getByText('Show all calibration levels')).toBeInTheDocument();
  });

  it('calls onSearch when the search button is clicked', () => {
    const onSearch = vi.fn();
    render(<SearchForm {...baseProps} onSearch={onSearch} />);
    fireEvent.click(screen.getByText('Search MAST'));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('calls onSearch when Enter is pressed in the target-name input', () => {
    const onSearch = vi.fn();
    render(<SearchForm {...baseProps} onSearch={onSearch} />);
    fireEvent.keyPress(screen.getByPlaceholderText('Target name (e.g., NGC 3132, Carina Nebula)'), {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
    });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('disables the search button while loading', () => {
    render(<SearchForm {...baseProps} loading={true} />);
    expect(screen.getByText('Searching MAST...').closest('button')).toBeDisabled();
  });
});
