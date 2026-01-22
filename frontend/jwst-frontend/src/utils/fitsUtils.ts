/**
 * FITS file type classification based on JWST naming conventions.
 * Determines if a FITS file contains viewable image data or non-viewable table data.
 */

export type FitsFileType = 'image' | 'table' | 'unknown';

export interface FitsFileInfo {
  type: FitsFileType;
  label: string;
  viewable: boolean;
  description: string;
}

// JWST file suffixes that indicate image data (viewable)
const IMAGE_SUFFIXES = [
  '_uncal',      // Uncalibrated data
  '_rate',       // Rate image
  '_rateints',   // Rate per integration
  '_cal',        // Calibrated image
  '_calints',    // Calibrated per integration
  '_i2d',        // 2D combined/mosaic image
  '_s2d',        // 2D spectral image
  '_s3d',        // 3D spectral cube
  '_crf',        // Cosmic ray flagged
  '_crfints',    // Cosmic ray flagged per integration
  '_bsub',       // Background subtracted
  '_bsubints',   // Background subtracted per integration
  '_srctype',    // Source type determination
  '_flat',       // Flat field
  '_dark',       // Dark current
  '_bias',       // Bias frame
  '_mask',       // Bad pixel mask
  '_wht',        // Weight map
  '_err',        // Error array
  '_dq',         // Data quality
];

// JWST file suffixes that indicate table/non-image data (not viewable as image)
const TABLE_SUFFIXES = [
  '_asn',        // Association file
  '_pool',       // Pool file
  '_x1d',        // 1D extracted spectrum
  '_x1dints',    // 1D extracted spectrum per integration
  '_c1d',        // Combined 1D spectrum
  '_cat',        // Source catalog
  '_segm',       // Segmentation map (could be image but usually table)
  '_phot',       // Photometry table
  '_spec',       // Spectral data (often table)
  '_wcs',        // WCS information
  '_apcorr',     // Aperture correction table
  '_psfstack',   // PSF stack
  '_psfalign',   // PSF alignment
  '_median',     // Median combination info
  '_outlier',    // Outlier detection
  '_tweakreg',   // Tweakreg catalog
];

/**
 * Determines the type and viewability of a FITS file based on its filename.
 * Uses JWST naming conventions to classify files.
 */
export const getFitsFileInfo = (filename: string): FitsFileInfo => {
  if (!filename) {
    return { type: 'unknown', label: 'Unknown', viewable: false, description: 'Unknown file type' };
  }

  const lowerFilename = filename.toLowerCase();

  // Check if it's a FITS file
  if (!lowerFilename.endsWith('.fits') && !lowerFilename.endsWith('.fit')) {
    return { type: 'unknown', label: 'Non-FITS', viewable: false, description: 'Not a FITS file' };
  }

  // Check for image suffixes first (more common)
  for (const suffix of IMAGE_SUFFIXES) {
    if (lowerFilename.includes(suffix)) {
      const label = suffix.replace('_', '').toUpperCase();
      return {
        type: 'image',
        label,
        viewable: true,
        description: getImageDescription(suffix)
      };
    }
  }

  // Check for table suffixes
  for (const suffix of TABLE_SUFFIXES) {
    if (lowerFilename.includes(suffix)) {
      const label = suffix.replace('_', '').toUpperCase();
      return {
        type: 'table',
        label,
        viewable: false,
        description: getTableDescription(suffix)
      };
    }
  }

  // Default: assume viewable if we can't determine
  return {
    type: 'unknown',
    label: 'FITS',
    viewable: true, // Attempt to view unknown files
    description: 'FITS file (type unknown)'
  };
};

/**
 * Quick check if a file is viewable as an image
 */
export const isFitsViewable = (filename: string): boolean => {
  return getFitsFileInfo(filename).viewable;
};

/**
 * Get the file type label for display
 */
export const getFitsTypeLabel = (filename: string): string => {
  return getFitsFileInfo(filename).label;
};

function getImageDescription(suffix: string): string {
  const descriptions: Record<string, string> = {
    '_uncal': 'Uncalibrated raw data',
    '_rate': 'Count rate image',
    '_rateints': 'Count rate per integration',
    '_cal': 'Calibrated image',
    '_calints': 'Calibrated per integration',
    '_i2d': '2D resampled/combined image',
    '_s2d': '2D spectral image',
    '_s3d': '3D spectral cube',
    '_crf': 'Cosmic ray flagged image',
    '_crfints': 'Cosmic ray flagged per integration',
    '_bsub': 'Background subtracted',
    '_flat': 'Flat field reference',
    '_dark': 'Dark current reference',
  };
  return descriptions[suffix] || 'Image data';
}

function getTableDescription(suffix: string): string {
  const descriptions: Record<string, string> = {
    '_asn': 'Association table',
    '_pool': 'Association pool',
    '_x1d': '1D extracted spectrum',
    '_x1dints': '1D spectrum per integration',
    '_c1d': 'Combined 1D spectrum',
    '_cat': 'Source catalog',
    '_phot': 'Photometry measurements',
  };
  return descriptions[suffix] || 'Table data';
}

/**
 * Calculates optimal display limits for FITS data using a robust percentile-based approach (similar to ZScale).
 * This prevents outliers (hot/cold pixels) from squashing the dynamic range.
 * 
 * @param data The pixel array (number[] or typed array)
 * @param sampleSize Number of pixels to sample for calculation (default 5000)
 * @param limits Percentile limits [low, high] (default [0.005, 0.995] i.e., 0.5% to 99.5%)
 */
export const calculateZScale = (
    data: any,
    sampleSize: number = 5000,
    limits: [number, number] = [0.005, 0.995]
): { min: number, max: number } => {

    if (!data || data.length === 0) {
        return { min: 0, max: 1 };
    }

    const len = data.length;
    // If small enough, use all data
    const useAll = len <= sampleSize;

    let sample: number[] = [];

    if (useAll) {
        // Convert to standard array for sorting if needed, filtering NaNs
        for (let i = 0; i < len; i++) {
            if (!isNaN(data[i])) sample.push(data[i]);
        }
    } else {
        // Step size
        const step = Math.floor(len / sampleSize);
        for (let i = 0; i < len; i += step) {
            const val = data[i];
            if (!isNaN(val)) sample.push(val);
        }
    }

    if (sample.length === 0) return { min: 0, max: 1 };

    // Sort numerically
    sample.sort((a, b) => a - b);

    const minIdx = Math.floor(sample.length * limits[0]);
    const maxIdx = Math.floor(sample.length * limits[1]);

    // Clamp indices
    const idx1 = Math.max(0, Math.min(minIdx, sample.length - 1));
    const idx2 = Math.max(0, Math.min(maxIdx, sample.length - 1));

    let min = sample[idx1];
    let max = sample[idx2];

    // Fallback if flat
    if (min === max) {
        if (min === 0) {
            max = 1;
        } else {
            min = min - Math.abs(min * 0.1);
            max = max + Math.abs(max * 0.1);
        }
    }

    return { min, max };
};
