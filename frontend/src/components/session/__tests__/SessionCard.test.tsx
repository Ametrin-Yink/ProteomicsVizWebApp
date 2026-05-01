import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MiniSessionCard } from '@/components/session/SessionCard';
import type { Session } from '@/types/session';

const mockSession: Session = {
  id: 'test-1',
  name: 'Test Session',
  status: 'created',
  currentStep: null,
  progress: 0,
  config: {
    name: 'Test',
    description: '',
    template: 'protein_pairwise_comparison',
    conditions: [],
    replicates: {},
    parameters: {
      minPeptides: 2,
      minSamples: 3,
      log2FoldChangeThreshold: 1,
      pValueThreshold: 0.05,
      gseaDatabase: 'KEGG',
      gseaMinSize: 15,
      gseaMaxSize: 500,
      pcaComponents: 3,
      normalizationMethod: 'none',
      imputationMethod: 'none',
    },
  },
  createdAt: '2026-04-29T00:00:00Z',
  updatedAt: '2026-04-29T00:00:00Z',
  completedAt: null,
  errorMessage: null,
  uploadedFiles: [],
  compoundFile: null,
  results: null,
};

describe('MiniSessionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session name and status', () => {
    render(<MiniSessionCard session={mockSession} />);
    expect(screen.getByTestId('session-name')).toHaveTextContent('Test Session');
    expect(screen.getByTestId('session-status')).toHaveTextContent('Created');
  });

  it('shows rename and delete buttons in normal mode', () => {
    render(<MiniSessionCard session={mockSession} onRename={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('session-rename-btn')).toBeInTheDocument();
    expect(screen.getByTestId('session-delete-btn')).toBeInTheDocument();
  });

  it('hides rename and delete buttons in select mode', () => {
    render(
      <MiniSessionCard
        session={mockSession}
        isSelectMode={true}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.queryByTestId('session-rename-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-delete-btn')).not.toBeInTheDocument();
  });

  it('shows checkbox in select mode', () => {
    render(<MiniSessionCard session={mockSession} isSelectMode={true} />);
    expect(screen.getByTestId('session-checkbox')).toBeInTheDocument();
  });

  it('calls onSelectChange when checkbox is toggled', () => {
    const onSelectChange = vi.fn();
    render(
      <MiniSessionCard
        session={mockSession}
        isSelectMode={true}
        isSelected={false}
        onSelectChange={onSelectChange}
      />
    );

    const checkbox = screen.getByTestId('session-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  it('calls onSelectChange when card body is clicked in select mode', () => {
    const onSelectChange = vi.fn();
    render(
      <MiniSessionCard
        session={mockSession}
        isSelectMode={true}
        isSelected={false}
        onSelectChange={onSelectChange}
      />
    );

    const cardBody = screen.getByTestId('session-name');
    fireEvent.click(cardBody);
    expect(onSelectChange).toHaveBeenCalledWith(true);
  });

  it('shows selected state via checkbox', () => {
    render(
      <MiniSessionCard
        session={mockSession}
        isSelectMode={true}
        isSelected={true}
        onSelectChange={vi.fn()}
      />
    );

    const checkbox = screen.getByTestId('session-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
