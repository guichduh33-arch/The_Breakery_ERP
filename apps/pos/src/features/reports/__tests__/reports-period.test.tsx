import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useReportsPeriod } from '../hooks/useReportsPeriod';
import { POSReportsLayout } from '../components/POSReportsLayout';

vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: { hasPermission: () => boolean }) => unknown) => selector({ hasPermission: () => true }) }));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T15:59:59.000Z')); });
afterEach(() => vi.useRealTimers());

describe('report period', () => {
  it('updates relative periods at business midnight without changing preset', () => {
    const hook = renderHook(() => useReportsPeriod(), { wrapper });
    expect(hook.result.current.period.startDate).toBe('2026-10-05');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(hook.result.current.period.startDate).toBe('2026-10-06');
    expect(hook.result.current.period.endDate).toBe('2026-10-06');
  });

  it('uses exact custom inclusive bounds and keeps them at midnight', () => {
    const hook = renderHook(() => useReportsPeriod(), { wrapper });
    act(() => hook.result.current.setPreset('custom'));
    act(() => hook.result.current.setCustomDate('start', '2026-09-01'));
    act(() => hook.result.current.setCustomDate('end', '2026-09-20'));
    expect(hook.result.current.period).toMatchObject({ startDate: '2026-09-01', endDate: '2026-09-20' });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(hook.result.current.period.startDate).toBe('2026-09-01');
    expect(hook.result.current.error).toBeNull();
  });

  it('rejects reversed and invalid calendar dates', () => {
    const hook = renderHook(() => useReportsPeriod(), { wrapper });
    act(() => hook.result.current.setPreset('custom'));
    act(() => hook.result.current.setCustomDate('start', '2026-12-01'));
    expect(hook.result.current.error).toMatch(/on or before/);
    act(() => hook.result.current.setCustomDate('start', '2026-02-30'));
    expect(hook.result.current.error).toMatch(/valid/);
  });

  it('preserves the selected custom period through report-tab remount', () => {
    const content = (period: { startDate: string; endDate: string }) => <p data-testid="bounds">{period.startDate}/{period.endDate}</p>;
    render(<MemoryRouter initialEntries={['/pos/reports?period=custom&from=2026-09-01&to=2026-09-20']}>
      <Routes>
        <Route path="/pos/reports" element={<POSReportsLayout activeTab="overview">{content}</POSReportsLayout>} />
        <Route path="/pos/reports/products" element={<POSReportsLayout activeTab="products">{content}</POSReportsLayout>} />
      </Routes>
    </MemoryRouter>);
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-09-01');
    fireEvent.click(screen.getByRole('button', { name: 'Products' }));
    expect(screen.getByTestId('bounds')).toHaveTextContent('2026-09-01/2026-09-20');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Start date must be on or before end date.');
    expect(screen.queryByTestId('bounds')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-02' } });
    expect(screen.getByTestId('bounds')).toHaveTextContent('2026-10-01/2026-10-02');
  });
});
