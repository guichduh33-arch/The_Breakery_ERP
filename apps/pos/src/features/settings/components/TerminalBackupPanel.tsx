import { useRef, useState, type JSX } from 'react';
import { Button, Card, Input, SectionLabel } from '@breakery/ui';
import { supabaseUrl } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useLanCredential } from '@/features/lan/lanCredential';
import { captureTerminalBackup, encryptTerminalBackup } from '@/features/lan/terminalBackup';

export function TerminalBackupPanel({ readOnly }: { readOnly: boolean }): JSX.Element {
  const [publicKey, setPublicKey] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const keySelection = useRef(0);

  async function exportBackup(): Promise<void> {
    const auth = useAuthStore.getState();
    if (readOnly || busy || !auth.isAuthenticated || auth.isLocked || !auth.hasPermission('settings.update')) return;
    setBusy(true); setMessage('Preparing encrypted export…');
    try {
      const projectRef = new URL(supabaseUrl).hostname.split('.')[0] ?? '';
      const terminalCode = useLanCredential.getState().credential?.code ?? '';
      const snapshot = await captureTerminalBackup({ projectRef, terminalCode,
        origin: window.location.origin, local: localStorage, session: sessionStorage,
        factory: typeof indexedDB === 'undefined' ? undefined : indexedDB });
      const blob = await encryptTerminalBackup(snapshot, publicKey);
      const currentAuth = useAuthStore.getState();
      if (!currentAuth.isAuthenticated || currentAuth.isLocked || !currentAuth.hasPermission('settings.update')) {
        throw new Error('Permission changed');
      }
      // Aucun contenu métier en clair dans le fichier téléchargé.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `breakery-terminal-${projectRef}-${Date.now()}.bkb`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage('Encrypted download requested. Verify the saved file on your recovery computer.');
    } catch {
      setMessage('Export failed. Check the public key, terminal pairing and browser support. Stop terminal activity before retrying.');
    } finally { setBusy(false); }
  }

  return (
    <Card variant="default" padding="md" className="space-y-3">
      <SectionLabel size="sm" as="h3">Encrypted terminal export</SectionLabel>
      <p className="text-xs text-text-secondary">
        Stop sales and synchronization before exporting. Includes pending operations,
        rejected operations and saved payment attempts for this origin and tab only.
        Export other terminals and open tabs separately. This does not restore or replay payments.
      </p>
      <label className="block text-sm text-text-secondary" htmlFor="terminal-recovery-public-key">
        Recovery public key (.pem) — never select the private key
      </label>
      <Input id="terminal-recovery-public-key" type="file" accept=".pem" disabled={readOnly || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          const selection = ++keySelection.current;
          setPublicKey(''); setFingerprint(''); setMessage('');
          if (!file || file.size > 4096) return;
          void file.text().then(async (pem) => {
            if (!pem.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Public key required');
            const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pem));
            if (selection !== keySelection.current) return;
            setFingerprint(Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, '0')).join(''));
            setPublicKey(pem);
          }).catch(() => { if (selection === keySelection.current) setMessage('Select a valid recovery public key.'); });
        }} />
      {fingerprint && <p className="text-xs text-text-muted break-all">Public key SHA-256: {fingerprint}</p>}
      <Button variant="secondary" size="sm" disabled={readOnly || busy || !publicKey}
        onClick={() => { void exportBackup(); }}>Download encrypted terminal export</Button>
      <p role="status" className="text-xs text-text-secondary">{message}</p>
    </Card>
  );
}
