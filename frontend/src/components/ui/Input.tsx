/**
 * Input Component
 * 
 * Text input with label, error handling, and icon support.
 * Follows design system with focus states.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Input props interface
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

/**
 * Input component
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className,
      id,
      ...props
    },
    ref
  ) => {
    // Generate unique ID if not provided
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const containerClasses = cn(
      'flex flex-col gap-1.5',
      fullWidth && 'w-full'
    );

    const labelClasses = cn(
      'text-sm font-medium text-[#1a1a2e]',
      disabled && 'opacity-50'
    );

    const inputWrapperClasses = cn(
      'relative flex items-center',
      fullWidth && 'w-full'
    );

    const inputClasses = cn(
      'flex h-11 w-full rounded-lg border bg-white px-4',
      'text-sm text-[#1a1a2e] placeholder:text-[#94a3b8]',
      'transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-0',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      
      // Error state
      error
        ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
        : 'border-[#e2e8f0] focus:border-[#E73564] focus:ring-[#E73564]/20',
      
      // Icon padding
      leftIcon && 'pl-11',
      rightIcon && 'pr-11',
      
      className
    );

    const iconClasses = cn(
      'absolute flex items-center justify-center',
      'text-[#94a3b8] pointer-events-none',
      'w-5 h-5'
    );

    const helperTextClasses = cn(
      'text-xs',
      error ? 'text-red-500' : 'text-[#64748b]'
    );

    return (
      <div className={containerClasses}>
        {label && (
          <label htmlFor={inputId} className={labelClasses}>
            {label}
          </label>
        )}
        
        <div className={inputWrapperClasses}>
          {leftIcon && (
            <div className={cn(iconClasses, 'left-3')}>
              {leftIcon}
            </div>
          )}
          
          <input
            ref={ref}
            id={inputId}
            className={inputClasses}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            {...props}
          />
          
          {rightIcon && (
            <div className={cn(iconClasses, 'right-3')}>
              {rightIcon}
            </div>
          )}
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

Input.displayName = 'Input';

// Textarea variant
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  rows?: number;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      helperText,
      fullWidth = false,
      disabled,
      rows = 4,
      className,
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const textareaId = id || generatedId;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;

    const containerClasses = cn(
      'flex flex-col gap-1.5',
      fullWidth && 'w-full'
    );

    const labelClasses = cn(
      'text-sm font-medium text-[#1a1a2e]',
      disabled && 'opacity-50'
    );

    const textareaClasses = cn(
      'flex w-full rounded-lg border bg-white px-4 py-3',
      'text-sm text-[#1a1a2e] placeholder:text-[#94a3b8]',
      'transition-all duration-200 resize-y',
      'focus:outline-none focus:ring-2 focus:ring-offset-0',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      
      // Error state
      error
        ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
        : 'border-[#e2e8f0] focus:border-[#E73564] focus:ring-[#E73564]/20',
      
      className
    );

    const helperTextClasses = cn(
      'text-xs',
      error ? 'text-red-500' : 'text-[#64748b]'
    );

    return (
      <div className={containerClasses}>
        {label && (
          <label htmlFor={textareaId} className={labelClasses}>
            {label}
          </label>
        )}
        
        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          className={textareaClasses}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          {...props}
        />
        
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

Textarea.displayName = 'Textarea';

// Convenience exports
export default Input;
