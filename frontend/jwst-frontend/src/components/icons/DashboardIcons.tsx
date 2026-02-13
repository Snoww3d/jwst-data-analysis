import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const defaultProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const TelescopeIcon: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <circle cx="12" cy="5" r="3" />
    <line x1="12" y1="8" x2="12" y2="14" />
    <line x1="12" y1="14" x2="6" y2="22" />
    <line x1="12" y1="14" x2="18" y2="22" />
    <line x1="8" y1="19" x2="16" y2="19" />
  </svg>
);

export const ImageIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

export const TableIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const TargetIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

export const TrashIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const ArchiveIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

export const LineageIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...defaultProps(size)} className={className}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M6 6a9 9 0 0 0 9 9" strokeWidth="2" fill="none" />
  </svg>
);
