import { describe, it, expect, beforeEach } from 'vitest';
import { usePosSettingsStore } from '../posSettingsStore';

describe('posSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    usePosSettingsStore.setState({ printerUrl: '' });
  });

  it('defaults: empty url', () => {
    const s = usePosSettingsStore.getState();
    expect(s.printerUrl).toBe('');
  });

  it('setPrinterUrl persists to localStorage under pos:settings', () => {
    usePosSettingsStore.getState().setPrinterUrl('http://192.168.1.50:3001');
    expect(usePosSettingsStore.getState().printerUrl).toBe('http://192.168.1.50:3001');
    const raw = localStorage.getItem('pos:settings');
    expect(raw).toContain('192.168.1.50');
  });
});
