// apps/backoffice/src/features/products/__tests__/product-image-uploader.smoke.test.tsx
//
// Smoke test for the product photo uploader (General tab "Visual Asset").
// Covers: empty render, readOnly hides actions, image present shows Replace/Remove,
// and a successful upload lifts the public URL via onChange.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      }),
    },
  },
}));

import { ProductImageUploader } from '../components/ProductImageUploader.js';

beforeEach(() => {
  uploadMock.mockReset();
  getPublicUrlMock.mockReset();
});

describe('ProductImageUploader', () => {
  it('renders the empty dropzone + Upload action', () => {
    render(<ProductImageUploader productId="p1" imageUrl={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /upload product image/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^upload$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('hides write actions when readOnly', () => {
    render(<ProductImageUploader productId="p1" imageUrl={null} readOnly onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^upload$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /replace/i })).not.toBeInTheDocument();
  });

  it('shows Replace + Remove when an image is present', () => {
    render(<ProductImageUploader productId="p1" imageUrl="https://x/i.png" onChange={vi.fn()} />);
    expect(screen.getByRole('img', { name: /product/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('Remove lifts null via onChange', () => {
    const onChange = vi.fn();
    render(<ProductImageUploader productId="p1" imageUrl="https://x/i.png" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('uploads a file and lifts the public URL', async () => {
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: 'https://cdn/product-images/products/p1/x.png' } });
    const onChange = vi.fn();
    const { container } = render(
      <ProductImageUploader productId="p1" imageUrl={null} onChange={onChange} />,
    );
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('https://cdn/product-images/products/p1/x.png');
    });
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsupported file type without uploading', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ProductImageUploader productId="p1" imageUrl={null} onChange={onChange} />,
    );
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const bad = new File(['x'], 'note.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [bad] } });

    await waitFor(() => {
      expect(screen.getByText(/unsupported format/i)).toBeInTheDocument();
    });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
