/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { PrintingSettingsTab } from '../components/PrintingSettingsTab';

beforeEach(() => {
  localStorage.clear();
  usePosSettingsStore.setState({ printerUrl: '', autoPrint: true, autoOpenDrawer: true });
});

describe('PrintingSettingsTab', () => {
  it('editing the URL persists to the store', () => {
    render(<PrintingSettingsTab />);
    const input = screen.getByLabelText(/print server url/i);
    fireEvent.change(input, { target: { value: 'http://192.168.1.77:3001' } });
    expect(usePosSettingsStore.getState().printerUrl).toBe('http://192.168.1.77:3001');
  });

  it('toggling auto-print flips the store flag', () => {
    render(<PrintingSettingsTab />);
    fireEvent.click(screen.getByRole('switch', { name: /auto-print/i }));
    expect(usePosSettingsStore.getState().autoPrint).toBe(false);
  });
});
