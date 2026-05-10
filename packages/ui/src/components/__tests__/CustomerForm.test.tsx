import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomerForm } from '../CustomerForm.js';

describe('CustomerForm', () => {
  it('disables submit when name is shorter than 2 chars', () => {
    const onSubmit = vi.fn();
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'A' } });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('submits trimmed name + optional phone/email when valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i),  { target: { value: '  Hassan Diop  ' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '+33612345678' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Hassan Diop', phone: '+33612345678', email: null });
  });

  it('rejects malformed email inline', () => {
    const onSubmit = vi.fn();
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i),  { target: { value: 'Foo Bar' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
  });

  it('prefills initialValues in edit mode', () => {
    render(
      <CustomerForm
        mode="edit"
        initialValues={{ name: 'Existing', phone: null, email: 'a@b.co' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByLabelText(/name/i)  as HTMLInputElement).value).toBe('Existing');
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('a@b.co');
  });
});
