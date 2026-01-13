
export type ColorMapName = 'grayscale' | 'heat' | 'cool' | 'rainbow' | 'viridis';

export type ColorMap = [number, number, number][];

// Helper to interpolate colors
const interpolate = (val: number, colors: [number, number, number][]): [number, number, number] => {
    // val is 0..1
    const idx = val * (colors.length - 1);
    const i = Math.floor(idx);
    const f = idx - i;

    if (i >= colors.length - 1) return colors[colors.length - 1];

    const c1 = colors[i];
    const c2 = colors[i + 1];

    return [
        Math.floor(c1[0] + (c2[0] - c1[0]) * f),
        Math.floor(c1[1] + (c2[1] - c1[1]) * f),
        Math.floor(c1[2] + (c2[2] - c1[2]) * f)
    ];
};

const generateLut = (keyPoints: [number, number, number][]): ColorMap => {
    const lut: ColorMap = [];
    for (let i = 0; i < 256; i++) {
        lut.push(interpolate(i / 255, keyPoints));
    }
    return lut;
};

// Keypoints for maps
const MAPS: Record<ColorMapName, ColorMap> = {
    grayscale: generateLut([[0, 0, 0], [255, 255, 255]]),

    heat: generateLut([
        [0, 0, 0],       // Black
        [128, 0, 0],     // Dark Red
        [255, 128, 0],   // Orange
        [255, 255, 255]  // White
    ]),

    cool: generateLut([
        [0, 0, 0],       // Black
        [0, 255, 255],   // Cyan
        [255, 0, 255]    // Magenta
    ]),

    rainbow: generateLut([
        [0, 0, 255],     // Blue
        [0, 255, 0],     // Green
        [255, 255, 0],   // Yellow
        [255, 0, 0]      // Red
    ]),

    viridis: generateLut([
        [68, 1, 84],
        [72, 35, 116],
        [65, 68, 135],
        [53, 95, 141],
        [42, 117, 142],
        [33, 145, 140],
        [34, 168, 132],
        [66, 190, 113],
        [122, 209, 81],
        [253, 231, 37]
    ])
};

export const getColorMap = (name: string): ColorMap => {
    return MAPS[name as ColorMapName] || MAPS['grayscale'];
};
