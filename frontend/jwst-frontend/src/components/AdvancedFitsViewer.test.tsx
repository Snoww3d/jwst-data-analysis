import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AdvancedFitsViewer from './AdvancedFitsViewer';

// Mock the global astro.FITS object
beforeAll(() => {
    window.astro = {
        FITS: jest.fn().mockImplementation((blob, callback) => {
            // Simulate successful parsing
            const mockHDU = {
                header: {
                    cards: {
                        'OBJECT': { value: 'Test Object' },
                        'INSTRUME': { value: 'NIRCAM' },
                        'TELESCOP': { value: 'JWST' },
                        'EXPTIME': { value: 1000 },
                        'DATE-OBS': { value: '2022-01-01' }
                    }
                },
                data: {
                    width: 100,
                    height: 100,
                    min: 0,
                    max: 100,
                    getFrame: jest.fn((index, cb) => cb([/* mock pixel data */]))
                },
                getHDU: () => mockHDU
            };

            // The component calls the callback within the constructor logic we assumed?
            // Actually, looking at the code: new window.astro.FITS(blob, function() { ... })
            // So we need to execute the callback with 'this' bound to the mock instance.
            // But for simple rendering check, we might not reach that immediately if we don't trigger it.
            // Let's just insure the constructor doesn't fail.

            if (callback) {
                // Bind strict context if needed, or just call it.
                // The component uses `this.getHDU()`.
                const mockInstance = {
                    getHDU: () => mockHDU
                };
                callback.call(mockInstance);
            }

            return {};
        })
    };
});

describe('AdvancedFitsViewer', () => {
    const mockOnClose = jest.fn();
    const mockUrl = 'http://localhost/test.fits';
    const mockDataId = 'test-id';

    it('renders the viewer components correctly', () => {
        render(
            <AdvancedFitsViewer
                dataId={mockDataId}
                url={mockUrl}
                onClose={mockOnClose}
            />
        );

        // Check for Header Elements (using getByText with regex for partial match or exact)
        // Note: OBJECT is 'Test Object' in our mock
        // Wait for async effect?
        // The component sets loading=true initially.

        expect(screen.getByText(/Loading Scientific Data/i)).toBeInTheDocument();

        // Check for Buttons
        expect(screen.getByTitle('Go Back')).toBeInTheDocument();
        expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
    });

    it('clicking close calls onClose', () => {

        render(
            <AdvancedFitsViewer
                dataId={mockDataId}
                url={mockUrl}
                onClose={mockOnClose}
            />
        );

        const backBtn = screen.getByTitle('Go Back');
        fireEvent.click(backBtn);
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
});
