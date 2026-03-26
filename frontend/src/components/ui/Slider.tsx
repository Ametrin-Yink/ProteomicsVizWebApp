'use client';

import React from 'react';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
}

export function Slider({ value, min, max, step = 0.5, onChange, label }: SliderProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 min-w-[44px] min-h-[44px] cursor-pointer"
        style={{
          // Ensure touch target is at least 44x44px
          padding: '12px 0',
        }}
        aria-label={label}
        role="slider"
      />
    </div>
  );
}
