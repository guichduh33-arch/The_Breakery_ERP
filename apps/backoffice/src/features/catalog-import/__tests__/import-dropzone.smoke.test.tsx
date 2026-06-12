// apps/backoffice/src/features/catalog-import/__tests__/import-dropzone.smoke.test.tsx
// S42 — P5 (a11y + non-xlsx drop feedback) and P6 (dragLeave relatedTarget guard).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportDropzone } from '../components/ImportDropzone.js';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

function makeFile(name: string): File {
  const file = new File(['x'], name);
  // jsdom may not implement File.arrayBuffer — stub it on the instance.
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(new ArrayBuffer(8)),
  });
  return file;
}

describe('ImportDropzone [S42 smoke]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('P5a: the hidden file input is out of the tab order (tabIndex -1)', () => {
    const { container } = render(<ImportDropzone onFile={vi.fn()} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).tabIndex).toBe(-1);
  });

  it('P5b: dropping a non-xlsx file shows an error and does not call onFile', () => {
    const onFile = vi.fn();
    render(<ImportDropzone onFile={onFile} />);
    fireEvent.drop(screen.getByTestId('import-dropzone'), {
      dataTransfer: { files: [makeFile('notes.txt')] },
    });
    expect(onFile).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Only .xlsx files are supported');
  });

  it('P5c: an uppercase .XLSX extension is accepted', async () => {
    const onFile = vi.fn();
    render(<ImportDropzone onFile={onFile} />);
    fireEvent.drop(screen.getByTestId('import-dropzone'), {
      dataTransfer: { files: [makeFile('CATALOG.XLSX')] },
    });
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('P6: dragleave towards a child keeps the drag-over highlight, leaving clears it', () => {
    render(<ImportDropzone onFile={vi.fn()} />);
    const zone = screen.getByTestId('import-dropzone');
    const child = zone.querySelector('p'); // any child element
    expect(child).not.toBeNull();

    fireEvent.dragOver(zone);
    expect(zone.className).toContain('border-gold');

    // Cursor moves onto a child → relatedTarget is inside the zone → keep state.
    fireEvent.dragLeave(zone, { relatedTarget: child });
    expect(zone.className).toContain('border-gold');

    // Cursor actually leaves → clear.
    fireEvent.dragLeave(zone, { relatedTarget: document.body });
    expect(zone.className).not.toContain('border-gold');
  });
});
