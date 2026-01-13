
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
