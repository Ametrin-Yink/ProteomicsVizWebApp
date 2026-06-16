/**
 * Mass Spectrum Icon
 * Custom SVG representing mass spectrometry peaks — the core technology in proteomics.
 * Uses currentColor to inherit text color from parent (compatible with Tailwind text-* classes).
 */

import React from 'react';

interface MassSpecIconProps {
  className?: string;
}

export const MassSpecIcon: React.FC<MassSpecIconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {/* Baseline (m/z axis) */}
    <line x1="2" y1="20" x2="22" y2="20" />
    {/* Peaks (intensity bars) */}
    <line x1="4.5" y1="20" x2="4.5" y2="10" />
    <line x1="7" y1="20" x2="7" y2="3" />
    <line x1="9.5" y1="20" x2="9.5" y2="14" />
    <line x1="12" y1="20" x2="12" y2="7" />
    <line x1="14.5" y1="20" x2="14.5" y2="11" />
    <line x1="17" y1="20" x2="17" y2="15" />
  </svg>
);

export default MassSpecIcon;
