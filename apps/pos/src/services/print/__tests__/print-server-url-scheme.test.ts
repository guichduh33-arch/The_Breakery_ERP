// apps/pos/src/services/print/__tests__/print-server-url-scheme.test.ts
// Boutique 2026-07-19 — un printerUrl saisi sans schéma rendait le bridge ET
// le hub injoignables en silence (URL relative / WebSocket invalide).
// getPrintServerUrl doit normaliser le schéma quelle que soit la source.
import { describe, it, expect, beforeEach } from 'vitest';
import { getPrintServerUrl } from '../printService';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
import { hubWsUrl } from '@/features/lan/hooks/useHubPresence';

beforeEach(() => {
  usePosSettingsStore.setState({ printerUrl: '' });
});

describe('getPrintServerUrl — scheme normalization', () => {
  it('prepends http:// to a scheme-less override', () => {
    usePosSettingsStore.setState({ printerUrl: '192.168.40.66:3001' });
    expect(getPrintServerUrl()).toBe('http://192.168.40.66:3001');
  });

  it('keeps an explicit http/https scheme untouched', () => {
    usePosSettingsStore.setState({ printerUrl: 'http://192.168.40.66:3001' });
    expect(getPrintServerUrl()).toBe('http://192.168.40.66:3001');
    usePosSettingsStore.setState({ printerUrl: 'HTTPS://hub.local:3001' });
    expect(getPrintServerUrl()).toBe('HTTPS://hub.local:3001');
  });

  it('feeds hubWsUrl a valid ws URL even from a scheme-less override', () => {
    usePosSettingsStore.setState({ printerUrl: '192.168.40.66:3001' });
    expect(hubWsUrl(getPrintServerUrl())).toBe('ws://192.168.40.66:3001/ws');
  });
});
