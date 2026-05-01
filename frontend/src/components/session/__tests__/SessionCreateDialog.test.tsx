import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionCreateDialog } from '@/components/session/SessionCreateDialog';

describe('SessionCreateDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
  };

  it('renders session name input and no description field', () => {
    render(<SessionCreateDialog {...defaultProps} />);

    expect(screen.getByLabelText(/session name/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/description/i)).not.toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<SessionCreateDialog {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/session name/i)).not.toBeInTheDocument();
  });

  it('calls onCreate with name and template on submit', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<SessionCreateDialog {...defaultProps} onCreate={onCreate} />);

    const nameInput = screen.getByLabelText(/session name/i);
    fireEvent.change(nameInput, { target: { value: 'My Test Session' } });

    const submitBtn = screen.getByRole('button', { name: /create session/i });
    fireEvent.click(submitBtn);

    await vi.waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('My Test Session', 'protein_pairwise_comparison');
    });
  });

  it('disables submit button when name is empty', () => {
    render(<SessionCreateDialog {...defaultProps} />);
    const submitBtn = screen.getByRole('button', { name: /create session/i });
    expect(submitBtn).toBeDisabled();
  });

  it('shows validation error for short name', async () => {
    render(<SessionCreateDialog {...defaultProps} />);

    const nameInput = screen.getByLabelText(/session name/i);
    fireEvent.change(nameInput, { target: { value: 'ab' } });

    const submitBtn = screen.getByRole('button', { name: /create session/i });
    fireEvent.click(submitBtn);

    await vi.waitFor(() => {
      expect(screen.getByText('Name must be at least 3 characters')).toBeInTheDocument();
    });
  });

  it('calls onClose on escape key', () => {
    render(<SessionCreateDialog {...defaultProps} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onClose when cancel button clicked', () => {
    const onClose = vi.fn();
    render(<SessionCreateDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
