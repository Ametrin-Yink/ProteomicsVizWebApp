/**
 * Card Component
 *
 * Versatile card component with multiple variants.
 * Uses design system with subtle shadows and clean borders.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Card variants
export type CardVariant = 'default' | 'elevated' | 'bordered' | 'flat';

// Card props interface
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  isHoverable?: boolean;
  isInteractive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

/**
 * Card component
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      children,
      variant = 'default',
      isHoverable = false,
      isInteractive = false,
      padding = 'md',
      className,
      ...props
    },
    ref
  ) => {
    const baseClasses = cn(
      'bg-background rounded-lg overflow-hidden',
      'transition-all duration-200'
    );

    const variantClasses: Record<CardVariant, string> = {
      default: cn(
        'shadow-[0_2px_8px_rgba(0,0,0,0.08)]',
        'border border-border'
      ),
      elevated: cn(
        'shadow-[0_8px_30px_rgba(0,0,0,0.12)]',
        'border border-transparent'
      ),
      bordered: cn(
        'shadow-none',
        'border-2 border-border'
      ),
      flat: cn(
        'shadow-none',
        'border border-border'
      ),
    };

    const paddingClasses = {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    };

    const hoverClasses = isHoverable && cn(
      'hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)]',
      'hover:-translate-y-1'
    );

    const interactiveClasses = isInteractive && cn(
      'cursor-pointer',
      'hover:border-primary/30',
      'active:scale-[0.99]'
    );

    const classes = cn(
      baseClasses,
      variantClasses[variant],
      paddingClasses[padding],
      hoverClasses,
      interactiveClasses,
      className
    );

    return (
      <div ref={ref} className={classes} {...props}>
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

// Card Header
export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ title, subtitle, action, children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex items-start justify-between gap-4',
          'pb-4 mb-4 border-b border-border',
          className
        )}
        {...props}
      >
        <div className="flex-1 min-w-0">
          {title && (
            <h3 className="text-lg font-semibold text-text-primary leading-tight">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="mt-1 text-sm text-text-secondary">
              {subtitle}
            </p>
          )}
          {children}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    );
  }
);

CardHeader.displayName = 'CardHeader';

// Card Content
export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn('', className)}
      {...props}
    />
  );
});

CardContent.displayName = 'CardContent';

// Card Footer
export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-end gap-3',
        'pt-4 mt-4 border-t border-border',
        className
      )}
      {...props}
    />
  );
});

CardFooter.displayName = 'CardFooter';

// Convenience exports
export default Card;
