/**
 * Select Component
 * 
 * Dropdown select with label and error handling.
 * Uses native select with custom styling.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';

// Select option type
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

// Select props interface
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: SelectOption[];
  placeholder?: string;
  fullWidth?: boolean;
}

/**
 * Select component
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      helperText,
      options,
      placeholder,
      fullWidth = false,
      disabled,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const selectId = id || generatedId;
    const errorId = `${selectId}-error`;
    const helperId = `${selectId}-helper`;

    const containerClasses = cn(
      'flex flex-col gap-1.5',
      fullWidth && 'w-full'
    );

    const labelClasses = cn(
      'text-sm font-medium text-[#1a1a2e]',
      disabled && 'opacity-50'
    );

    const wrapperClasses = cn(
      'relative',
      fullWidth && 'w-full'
    );

    const selectClasses = cn(
      'flex h-11 w-full appearance-none rounded-lg border bg-white px-4 pr-10',
      'text-sm text-[#1a1a2e]',
      'transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-0',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      
      // Error state
      error
        ? 'border-error focus:border-error focus:ring-error/20'
        : 'border-[#e2e8f0] focus:border-[#E73564] focus:ring-[#E73564]/20',
      
      className
    );

    const iconClasses = cn(
      'absolute right-3 top-1/2 -translate-y-1/2',
      'pointer-events-none text-[#94a3b8]',
      'w-5 h-5'
    );

    const helperTextClasses = cn(
      'text-xs',
      error ? 'text-error' : 'text-[#64748b]'
    );

    return (
      <div className={containerClasses}>
        {label && (
          <label htmlFor={selectId} className={labelClasses}>
            {label}
          </label>
        )}
        
        <div className={wrapperClasses}>
          <select
            ref={ref}
            id={selectId}
            className={selectClasses}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))}
          </select>
          
          <ChevronDown className={iconClasses} />
        </div>
        
        {(error || helperText) && (
          <p
            id={error ? errorId : helperId}
            className={helperTextClasses}
          >
            {error || helperText}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

// Multi-select variant
export interface MultiSelectProps {
  label?: string;
  error?: string;
  helperText?: string;
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  fullWidth?: boolean;
  disabled?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  error,
  helperText,
  options,
  value,
  onChange,
  placeholder = 'Select options...',
  fullWidth = false,
  disabled,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const selectedLabels = options
    .filter((o) => value.includes(o.value))
    .map((o) => o.label);

  const containerClasses = cn(
    'flex flex-col gap-1.5',
    fullWidth && 'w-full'
  );

  const labelClasses = cn(
    'text-sm font-medium text-[#1a1a2e]',
    disabled && 'opacity-50'
  );

  const triggerClasses = cn(
    'flex h-11 w-full items-center justify-between rounded-lg border bg-white px-4',
    'text-sm text-[#1a1a2e]',
    'transition-all duration-200 cursor-pointer',
    'focus:outline-none focus:ring-2 focus:ring-offset-0',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    
    error
      ? 'border-error focus:border-error focus:ring-error/20'
      : 'border-[#e2e8f0] focus:border-[#E73564] focus:ring-[#E73564]/20',
    
    isOpen && 'border-[#E73564] ring-2 ring-[#E73564]/20'
  );

  const dropdownClasses = cn(
    'absolute z-50 w-full mt-1 rounded-lg border border-[#e2e8f0] bg-white shadow-lg',
    'max-h-60 overflow-auto'
  );

  const optionClasses = (isSelected: boolean) => cn(
    'flex items-center gap-2 px-4 py-2.5 text-sm cursor-pointer',
    'hover:bg-[#E73564]/5',
    isSelected && 'bg-[#E73564]/10 text-[#E73564]'
  );

  const helperTextClasses = cn(
    'text-xs',
    error ? 'text-error' : 'text-[#64748b]'
  );

  return (
    <div className={containerClasses} ref={containerRef}>
      {label && (
        <label className={labelClasses}>
          {label}
        </label>
      )}
      
      <div className="relative">
        <button
          type="button"
          className={triggerClasses}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <span className={cn('truncate', !value.length && 'text-[#94a3b8]')}>
            {value.length > 0
              ? selectedLabels.join(', ')
              : placeholder}
          </span>
          <ChevronDown
            className={cn(
              'w-5 h-5 text-[#94a3b8] transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </button>
        
        {isOpen && (
          <div className={dropdownClasses} role="listbox">
            {options.map((option) => (
              <div
                key={option.value}
                className={optionClasses(value.includes(option.value))}
                onClick={() => toggleOption(option.value)}
                role="option"
                aria-selected={value.includes(option.value)}
              >
                <input
                  type="checkbox"
                  checked={value.includes(option.value)}
                  onChange={() => {}}
                  className="rounded border-[#e2e8f0] text-[#E73564] focus:ring-[#E73564]"
                />
                <span>{option.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {(error || helperText) && (
        <p className={helperTextClasses}>
          {error || helperText}
        </p>
      )}
    </div>
  );
};

// Convenience exports
export default Select;
