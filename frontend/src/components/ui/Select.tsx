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
      'text-sm font-medium text-text-primary',
      disabled && 'opacity-50'
    );

    const wrapperClasses = cn(
      'relative',
      fullWidth && 'w-full'
    );

    const selectClasses = cn(
      'flex h-11 w-full appearance-none rounded-lg border bg-background px-4 pr-10',
      'text-sm text-text-primary',
      'transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-0',
      'disabled:opacity-50 disabled:cursor-not-allowed',

      // Error state
      error
        ? 'border-error focus:border-error focus:ring-error/20'
        : 'border-border focus:border-primary focus:ring-primary/20',

      className
    );

    const iconClasses = cn(
      'absolute right-3 top-1/2 -translate-y-1/2',
      'pointer-events-none text-text-muted',
      'w-5 h-5'
    );

    const helperTextClasses = cn(
      'text-xs',
      error ? 'text-error' : 'text-text-secondary'
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
  const [focusedIndex, setFocusedIndex] = React.useState(-1);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const optionRefs = React.useRef<(HTMLDivElement | null)[]>([]);

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

  // Reset focused index when dropdown opens/closes or options change
  React.useEffect(() => {
    if (isOpen) {
      setFocusedIndex(0);
    } else {
      setFocusedIndex(-1);
    }
  }, [isOpen]);

  // Scroll focused option into view
  React.useEffect(() => {
    if (focusedIndex >= 0 && optionRefs.current[focusedIndex]) {
      optionRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

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
    'text-sm font-medium text-text-primary',
    disabled && 'opacity-50'
  );

  const triggerClasses = cn(
    'flex h-11 w-full items-center justify-between rounded-lg border bg-background px-4',
    'text-sm text-text-primary',
    'transition-all duration-200 cursor-pointer',
    'focus:outline-none focus:ring-2 focus:ring-offset-0',
    'disabled:opacity-50 disabled:cursor-not-allowed',

    error
      ? 'border-error focus:border-error focus:ring-error/20'
      : 'border-border focus:border-primary focus:ring-primary/20',

    isOpen && 'border-primary ring-2 ring-primary/20'
  );

  const dropdownClasses = cn(
    'absolute z-50 w-full mt-1 rounded-lg border border-border bg-background shadow-lg',
    'max-h-60 overflow-auto'
  );

  const optionClasses = (isSelected: boolean) => cn(
    'flex items-center gap-2 px-4 py-2.5 text-sm cursor-pointer',
    'hover:bg-primary/5',
    isSelected && 'bg-primary/10 text-primary'
  );

  const helperTextClasses = cn(
    'text-xs',
    error ? 'text-error' : 'text-text-secondary'
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;

      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
        break;

      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
        break;

      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;

      case 'End':
        e.preventDefault();
        setFocusedIndex(options.length - 1);
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < options.length) {
          toggleOption(options[focusedIndex].value);
        }
        break;
    }
  };

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
          aria-controls={isOpen ? 'multiselect-listbox' : undefined}
          aria-activedescendant={focusedIndex >= 0 ? `multiselect-option-${focusedIndex}` : undefined}
        >
          <span className={cn('truncate', !value.length && 'text-text-muted')}>
            {value.length > 0
              ? selectedLabels.join(', ')
              : placeholder}
          </span>
          <ChevronDown
            className={cn(
              'w-5 h-5 text-text-muted transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {isOpen && (
          <div
            ref={dropdownRef}
            id="multiselect-listbox"
            className={dropdownClasses}
            role="listbox"
            aria-multiselectable="true"
            onKeyDown={handleKeyDown}
            tabIndex={-1}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`multiselect-option-${index}`}
                ref={(el) => { optionRefs.current[index] = el; }}
                className={cn(
                  optionClasses(value.includes(option.value)),
                  focusedIndex === index && 'bg-primary/10 ring-1 ring-primary/30'
                )}
                onClick={() => toggleOption(option.value)}
                role="option"
                aria-selected={value.includes(option.value)}
                tabIndex={-1}
              >
                <input
                  type="checkbox"
                  checked={value.includes(option.value)}
                  onChange={() => {}}
                  className="rounded border-border text-primary focus:ring-primary"
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

// Searchable single-select with filter input

// Searchable single-select with filter input
export interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  className,
  disabled,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    if (!isOpen) {
      setSearch('');
    }
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value);
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const triggerClasses = cn(
    'flex h-10 w-full items-center justify-between rounded-lg border bg-background px-3',
    'text-sm text-text-primary',
    'transition-all duration-200 cursor-pointer',
    'focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-primary/20 focus:border-primary',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    isOpen && 'border-primary ring-2 ring-primary/20',
    className
  );

  const dropdownClasses = cn(
    'absolute z-50 w-full mt-1 rounded-lg border border-border bg-background shadow-lg overflow-hidden'
  );

  const optionClasses = (isSelected: boolean) => cn(
    'w-full text-left px-3 py-2 text-sm transition-colors',
    isSelected
      ? 'bg-primary/10 text-primary font-medium'
      : 'text-text-primary hover:bg-surface'
  );

  return (
    <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={triggerClasses}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className={cn('truncate', !selectedOption && 'text-text-muted')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-text-muted flex-shrink-0 transition-transform ml-2',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className={dropdownClasses}>
          <div className="p-2 border-b border-border">
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-8 px-2 rounded-md border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-text-muted text-center">
                No matches
              </div>
            ) : (
              filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={optionClasses(option.value === value)}
                  onClick={() => handleSelect(option.value)}
                  role="option"
                  aria-selected={option.value === value}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Convenience exports
export default Select;
