import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TerminalBackupPanel } from '../components/TerminalBackupPanel';

const state = vi.hoisted(() => ({ authenticated: true, allowed: true, locked: false,
  capture: vi.fn(), encrypt: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://getctmbpjnrrjzncaqze.supabase.co' }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({
  isAuthenticated: state.authenticated, isLocked: state.locked, hasPermission: () => state.allowed,
}) } }));
vi.mock('@/features/lan/lanCredential', () => ({ useLanCredential: {
  getState: () => ({ credential: { code: 'POS-1' } }),
} }));
vi.mock('@/features/lan/terminalBackup', () => ({
  captureTerminalBackup: state.capture, encryptTerminalBackup: state.encrypt,
}));

describe('terminal encrypted export action', () => {
  beforeEach(() => {
    state.authenticated = true; state.allowed = true; state.locked = false;
    state.capture.mockReset().mockResolvedValue({ version: 1 });
    state.encrypt.mockReset().mockResolvedValue(new Blob(['encrypted fixture']));
    vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fixture') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function selectKey(text = '-----BEGIN PUBLIC KEY-----\nfixture') {
    fireEvent.change(screen.getByLabelText(/Recovery public key/), {
      target: { files: [{ size: text.length, text: async () => text }] },
    });
    await waitFor(() => expect(screen.getByText(/Public key SHA-256:/)).toBeTruthy());
  }

  it('disables selection and export without settings permission', () => {
    render(React.createElement(TerminalBackupPanel, { readOnly: true }));
    expect(screen.getByLabelText(/Recovery public key/).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Download encrypted/ }).disabled).toBe(true);
  });

  it('rejects a private key without collecting business data', async () => {
    render(React.createElement(TerminalBackupPanel, { readOnly: false }));
    fireEvent.change(screen.getByLabelText(/Recovery public key/), {
      target: { files: [{ size: 50, text: async () => '-----BEGIN PRIVATE KEY-----' }] },
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('valid recovery public key'));
    expect(state.capture).not.toHaveBeenCalled();
  });

  it('requests only an encrypted local download after capture and encryption', async () => {
    render(React.createElement(TerminalBackupPanel, { readOnly: false }));
    await selectKey();
    fireEvent.click(screen.getByRole('button', { name: /Download encrypted/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('download requested'));
    expect(state.capture.mock.calls[0][0].projectRef).toBe('getctmbpjnrrjzncaqze');
    expect(state.encrypt).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it('does not export after the session is locked', async () => {
    render(React.createElement(TerminalBackupPanel, { readOnly: false }));
    await selectKey();
    state.locked = true;
    fireEvent.click(screen.getByRole('button', { name: /Download encrypted/ }));
    expect(state.capture).not.toHaveBeenCalled();
  });
});
