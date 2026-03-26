import { render, screen, fireEvent } from '@testing-library/react';
import { Slider } from '@/components/ui/Slider';

describe('Slider Accessibility', () => {
  it('should have minimum 44px touch target', () => {
    render(<Slider value={2} min={0} max={5} onChange={() => {}} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveStyle({ minWidth: '44px', minHeight: '44px' });
  });

  it('should call onChange when value changes', () => {
    const handleChange = jest.fn();
    render(<Slider value={2} min={0} max={5} onChange={handleChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '3' } });
    expect(handleChange).toHaveBeenCalledWith(3);
  });
});
