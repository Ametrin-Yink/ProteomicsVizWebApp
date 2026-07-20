'use client';

export interface VisualizationScopeOption<T extends string> {
  key: T;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function VisualizationScopeTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: VisualizationScopeOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-background p-3">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          disabled={option.disabled}
          title={option.disabled ? option.disabledReason : option.description}
          onClick={() => onChange(option.key)}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            value === option.key
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:bg-surface'
          } ${option.disabled ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
