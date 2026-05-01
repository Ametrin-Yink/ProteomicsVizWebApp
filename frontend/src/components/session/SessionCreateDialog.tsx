/**
 * Session Create Dialog Component
 * 
 * Dialog for creating a new analysis session.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { X, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { AnalysisTemplate } from '@/types/session';

// Dialog props
export interface SessionCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, template: AnalysisTemplate) => void;
  className?: string;
}

// Template options
const templates: Array<{ id: AnalysisTemplate; name: string; description: string; available: boolean }> = [
  {
    id: 'protein_pairwise_comparison',
    name: 'Protein Pair-wise Comparison',
    description: 'Compare protein expression between two conditions',
    available: true,
  },
  {
    id: 'time_series_analysis',
    name: 'Time Series Analysis',
    description: 'Analyze protein changes over time points',
    available: false,
  },
  {
    id: 'multi_condition_comparison',
    name: 'Multi-Condition Analysis',
    description: 'Compare multiple conditions simultaneously',
    available: false,
  },
  {
    id: 'custom',
    name: 'Custom Analysis',
    description: 'Define your own analysis parameters',
    available: false,
  },
];

/**
 * Session Create Dialog component
 */
export const SessionCreateDialog: React.FC<SessionCreateDialogProps> = ({
  isOpen,
  onClose,
  onCreate,
  className,
}) => {
  const [name, setName] = React.useState('');
  const [selectedTemplate, setSelectedTemplate] = React.useState<AnalysisTemplate>('protein_pairwise_comparison');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<{ name?: string }>({});

  // Reset form when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      setName('');
      setSelectedTemplate('protein_pairwise_comparison');
      setErrors({});
    }
  }, [isOpen]);

  // Close on escape
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const validate = (): boolean => {
    const newErrors: { name?: string } = {};

    if (!name.trim()) {
      newErrors.name = 'Session name is required';
    } else if (name.length < 3) {
      newErrors.name = 'Name must be at least 3 characters';
    } else if (name.length > 100) {
      newErrors.name = 'Name must be less than 100 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setIsSubmitting(true);
    
    try {
      await onCreate(name.trim(), selectedTemplate);
      onClose();
    } catch (error) {
      console.error('Failed to create session:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTemplateSelect = (templateId: AnalysisTemplate, available: boolean) => {
    if (!available) return;
    setSelectedTemplate(templateId);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        data-testid="new-analysis-dialog"
        className={cn(
          'relative w-full max-w-lg bg-background rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto',
          'animate-in fade-in zoom-in-95 duration-200',
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <FlaskConical className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-text">
                New Analysis Session
              </h2>
              <p className="text-sm text-text-text-secondary">
                Create a new proteomics analysis
              </p>
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Session name */}
          <Input
            label="Session Name"
            placeholder="e.g., Drug Treatment vs Control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            fullWidth
            autoFocus
            data-testid="session-name-input"
          />

          {/* Template selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-text-text">
              Analysis Template
            </label>
            
            <div className="grid gap-3">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={cn(
                    'relative p-4 rounded-xl border-2 transition-all duration-200',
                    template.available
                      ? 'cursor-pointer hover:border-primary/50 hover:bg-primary/5'
                      : 'opacity-60 cursor-not-allowed',
                    selectedTemplate === template.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border-border bg-background'
                  )}
                  onClick={() => handleTemplateSelect(template.id, template.available)}
                >
                  <div className="flex items-start gap-3">
                    {/* Radio indicator */}
                    <div
                      className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5',
                        selectedTemplate === template.id
                          ? 'border-primary'
                          : 'border-border-border'
                      )}
                    >
                      {selectedTemplate === template.id && (
                        <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                      )}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-text">
                          {template.name}
                        </span>
                        {!template.available && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-border-border text-text-text-secondary rounded-full">
                            Coming Soon
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-text-text-secondary mt-1">
                        {template.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border-border">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={isSubmitting}
              disabled={!name.trim() || isSubmitting}
              data-testid="create-analysis-btn"
            >
              Create Session
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Convenience exports
export default SessionCreateDialog;
