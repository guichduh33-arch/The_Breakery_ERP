import { describe, it, expect, beforeEach } from 'vitest';
import { usePosSettingsStore } from '../posSettingsStore';

describe('posSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    usePosSettingsStore.setState({ printerUrl: '', autoPrint: true, autoOpenDrawer: true });
  });

  it('defaults: empty url, autoPrint + autoOpenDrawer on', () => {
    const s = usePosSettingsStore.getState();
    expect(s.printerUrl).toBe('');
    expect(s.autoPrint).toBe(true);
    expect(s.autoOpenDrawer).toBe(true);
  });

  it('setPrinterUrl persists to localStorage under pos:settings', () => {
    usePosSettingsStore.getState().setPrinterUrl('http://192.168.1.50:3001');
    expect(usePosSettingsStore.getState().printerUrl).toBe('http://192.168.1.50:3001');
    const raw = localStorage.getItem('pos:settings');
    expect(raw).toContain('192.168.1.50');
  });

  it('toggles flip booleans', () => {
    usePosSettingsStore.getState().setAutoPrint(false);
    usePosSettingsStore.getState().setAutoOpenDrawer(false);
    const s = usePosSettingsStore.getState();
    expect(s.autoPrint).toBe(false);
    expect(s.autoOpenDrawer).toBe(false);
  });
});
