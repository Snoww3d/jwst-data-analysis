import React, { useId } from 'react';
import { JwstDataModel } from '../../types/JwstDataTypes';
import { FootprintResponse } from '../../types/MosaicTypes';

interface FootprintPreviewProps {
  footprintData: FootprintResponse;
  selectedImages: JwstDataModel[];
}

// Colors for different files
const FOOTPRINT_COLORS = [
  '#4488ff',
  '#44ddff',
  '#ff8844',
  '#44ff88',
  '#ff44aa',
  '#ffdd44',
  '#aa44ff',
];

/**
 * SVG-based footprint visualization showing WCS coverage rectangles
 */
export const FootprintPreview: React.FC<FootprintPreviewProps> = ({
  footprintData,
  selectedImages,
}) => {
  const { footprints, bounding_box } = footprintData;
  const patternId = useId().replace(/:/g, '_');

  if (footprints.length === 0) {
    return <p className="mosaic-footprint-empty">No WCS data found in selected files.</p>;
  }

  // SVG viewport dimensions
  const svgWidth = 400;
  const svgHeight = 300;
  const padding = 30;

  // Coordinate range with padding
  const raRange = bounding_box.max_ra - bounding_box.min_ra;
  const decRange = bounding_box.max_dec - bounding_box.min_dec;
  const padFactor = 0.1;
  const minRa = bounding_box.min_ra - raRange * padFactor;
  const maxRa = bounding_box.max_ra + raRange * padFactor;
  const minDec = bounding_box.min_dec - decRange * padFactor;
  const maxDec = bounding_box.max_dec + decRange * padFactor;
  const totalRa = maxRa - minRa || 1;
  const totalDec = maxDec - minDec || 1;

  // Map RA/Dec to SVG coordinates
  // RA increases to the left in astronomical convention
  const toSvgX = (ra: number) => padding + ((maxRa - ra) / totalRa) * (svgWidth - 2 * padding);
  const toSvgY = (dec: number) => padding + ((maxDec - dec) / totalDec) * (svgHeight - 2 * padding);

  return (
    <div className="mosaic-footprint-svg-container">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="mosaic-footprint-svg"
        aria-label="WCS footprint preview showing sky coverage of selected files"
      >
        {/* Grid lines */}
        <defs>
          <pattern id={patternId} width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width={svgWidth} height={svgHeight} fill="#1a1a2e" rx="4" />
        <rect
          x={padding}
          y={padding}
          width={svgWidth - 2 * padding}
          height={svgHeight - 2 * padding}
          fill={`url(#${patternId})`}
        />

        {/* Bounding box */}
        <rect
          x={toSvgX(bounding_box.max_ra)}
          y={toSvgY(bounding_box.max_dec)}
          width={toSvgX(bounding_box.min_ra) - toSvgX(bounding_box.max_ra)}
          height={toSvgY(bounding_box.min_dec) - toSvgY(bounding_box.max_dec)}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
          strokeDasharray="4 2"
        />

        {/* Footprint polygons */}
        {footprints.map((fp, i) => {
          const color = FOOTPRINT_COLORS[i % FOOTPRINT_COLORS.length];
          const points = fp.corners_ra
            .map((ra, j) => `${toSvgX(ra)},${toSvgY(fp.corners_dec[j])}`)
            .join(' ');
          return (
            <g key={i}>
              <polygon
                points={points}
                fill={color}
                fillOpacity="0.15"
                stroke={color}
                strokeWidth="1.5"
                strokeOpacity="0.8"
              />
              <circle
                cx={toSvgX(fp.center_ra)}
                cy={toSvgY(fp.center_dec)}
                r="3"
                fill={color}
                opacity="0.9"
              />
            </g>
          );
        })}

        {/* Axis labels */}
        <text x={svgWidth / 2} y={svgHeight - 5} textAnchor="middle" fill="#888" fontSize="10">
          RA (deg)
        </text>
        <text
          x="10"
          y={svgHeight / 2}
          textAnchor="middle"
          fill="#888"
          fontSize="10"
          transform={`rotate(-90, 10, ${svgHeight / 2})`}
        >
          Dec (deg)
        </text>

        {/* Corner labels */}
        <text x={padding} y={svgHeight - padding + 15} fill="#666" fontSize="8">
          {maxRa.toFixed(4)}
        </text>
        <text
          x={svgWidth - padding}
          y={svgHeight - padding + 15}
          fill="#666"
          fontSize="8"
          textAnchor="end"
        >
          {minRa.toFixed(4)}
        </text>
        <text x={padding - 5} y={padding + 3} fill="#666" fontSize="8" textAnchor="end">
          {maxDec.toFixed(4)}
        </text>
        <text x={padding - 5} y={svgHeight - padding} fill="#666" fontSize="8" textAnchor="end">
          {minDec.toFixed(4)}
        </text>
      </svg>

      {/* Legend */}
      <div className="mosaic-footprint-legend">
        {footprints.map((fp, i) => {
          const color = FOOTPRINT_COLORS[i % FOOTPRINT_COLORS.length];
          const matchingImage = selectedImages.find((img) =>
            fp.file_path.includes(img.fileName.replace('.fits.gz', '.fits').replace('.fits', ''))
          );
          const label = matchingImage?.fileName || fp.file_path.split('/').pop() || `File ${i + 1}`;
          return (
            <div key={i} className="mosaic-footprint-legend-item">
              <span className="mosaic-legend-color" style={{ backgroundColor: color }} />
              <span className="mosaic-legend-label" title={label}>
                {label.length > 25 ? label.slice(0, 22) + '...' : label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FootprintPreview;
