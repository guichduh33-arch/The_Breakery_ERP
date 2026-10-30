import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OpnameFileActions } from '../components/OpnameFileActions.js';

const mocks = vi.hoisted(() => ({ load: vi.fn(), parse: vi.fn(), save: vi.fn() }));
vi.mock('../opnameImport.js', () => ({ loadCountProducts: mocks.load, importCountRows: mocks.save }));
vi.mock('../opnameWorkbook.js', () => ({ parseOpnameWorkbook: mocks.parse }));
const row = { productId: 'a', sku: '001', unit: 'kg', quantity: 0, notes: '' };
function renderActions(disabled = false) {
  return render(<QueryClientProvider client={new QueryClient()}>
    <OpnameFileActions countId="count" items={[]} disabled={disabled} onBusyChange={vi.fn()} />
  </QueryClientProvider>);
}
function upload() {
  const file = new File(['workbook'], 'count.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new ArrayBuffer(0)) });
  fireEvent.change(screen.getByLabelText('Import counts (.xlsx)'), { target: { files: [file] } });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue([]);
  mocks.parse.mockReturnValue({ rows: [row], errors: [] });
});
describe('stock count file workflow', () => {
  it('previews the file and requires confirmation before recording quantities', async () => {
    mocks.save.mockImplementation((_id: string, _rows: unknown, saved: () => void) => { saved(); return Promise.resolve(); });
    renderActions(); upload();
    await screen.findByText(/1 rows ready/);
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByText(/1 counts imported/);
    expect(mocks.save).toHaveBeenCalledWith('count', [row], expect.any(Function));
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
  });
  it('rejects the whole file on validation errors', async () => {
    mocks.parse.mockReturnValue({ rows: [row], errors: ['Row 3: Unknown SKU.'] });
    renderActions(); upload();
    expect(await screen.findByRole('alert')).toHaveTextContent('Row 3: Unknown SKU.');
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('retains only unsaved rows after a partial failure', async () => {
    const second = { ...row, productId: 'b', sku: '002' };
    mocks.parse.mockReturnValue({ rows: [row, second], errors: [] });
    mocks.save.mockImplementation((_id: string, _rows: unknown, saved: () => void) => { saved(); return Promise.reject(new Error('Connection lost')); });
    renderActions(); upload();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm import' }));
    await screen.findByRole('alert');
    await waitFor(() => { expect(screen.queryByText('001')).not.toBeInTheDocument(); });
    expect(screen.getByText('002')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('1 rows saved');
  });
  it('disables file operations while another edit is unsaved', () => {
    renderActions(true);
    expect(screen.getByRole('button', { name: 'Download template' })).toBeDisabled();
    expect(screen.getByLabelText('Import counts (.xlsx)')).toBeDisabled();
  });
});
