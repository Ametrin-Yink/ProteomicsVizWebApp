/**
 * Button Component
 * 
 * Custom button with primary/secondary color variants.
 * Uses design system colors: #E73564 (pink) and #00ADEF (cyan)
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

// Button variants
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

// Button props interface
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

/**
 * Button component with variants
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className,
      ...props
    },
    ref
  ) => {
    // Base classes
    const baseClasses = cn(
      'inline-flex items-center justify-center gap-2',
      'font-semibold rounded-md transition-all duration-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      'active:scale-[0.98]',
      fullWidth && 'w-full'
    );

    // Variant classes
    const variantClasses: Record<ButtonVariant, string> = {
      primary: cn(
        'bg-primary text-white',
        'hover:bg-primary-dark',
        'focus-visible:ring-primary',
        // Matches --shadow-primary design token: 0 4px 14px 0 rgba(231, 53, 100, 0.39)
        'shadow-[0_4px_14px_0_rgba(231,53,100,0.39)]',
        'hover:shadow-[0_6px_20px_0_rgba(231,53,100,0.45)]'
      ),
      secondary: cn(
        'bg-secondary text-white',
        'hover:bg-secondary-dark',
        'focus-visible:ring-secondary',
        // Matches --shadow-secondary design token: 0 4px 14px 0 rgba(0, 173, 239, 0.39)
        'shadow-[0_4px_14px_0_rgba(0,173,239,0.39)]',
        'hover:shadow-[0_6px_20px_0_rgba(0,173,239,0.45)]'
      ),
      outline: cn(
        'bg-transparent border-2 border-primary text-primary',
        'hover:bg-primary/5',
        'focus-visible:ring-primary'
      ),
      ghost: cn(
        'bg-transparent text-text-primary',
        'hover:bg-primary/10 hover:text-primary',
        'focus-visible:ring-primary'
      ),
      danger: cn(
        'bg-error text-white',
        'hover:bg-error/90',
        'focus-visible:ring-error'
      ),
    };

    // Size classes
    const sizeClasses: Record<ButtonSize, string> = {
      sm: 'h-9 px-4 text-sm',
      md: 'h-11 px-6 text-sm',
      lg: 'h-14 px-8 text-base',
      icon: 'h-10 w-10',
    };

    const classes = cn(
      baseClasses,
      variantClasses[variant],
      sizeClasses[size],
      className
    );

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {!isLoading && leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';

// Convenience exports
export default Button;
