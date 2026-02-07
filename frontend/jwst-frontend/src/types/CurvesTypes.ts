/** A single control point on the curves editor canvas */
export interface CurveControlPoint {
  /** Input brightness 0.0-1.0 (x-axis) */
  input: number;
  /** Output brightness 0.0-1.0 (y-axis) */
  output: number;
}

/** Named preset for common curve adjustments */
export type CurvePresetName = 'linear' | 'auto_contrast' | 'high_contrast' | 'invert';

/** Definition of a preset curve */
export interface CurvePreset {
  name: CurvePresetName;
  label: string;
  description: string;
  points: CurveControlPoint[];
}

/** A 256-entry lookup table mapping input [0..255] to output [0..255] */
export type LookupTable = Uint8Array;
