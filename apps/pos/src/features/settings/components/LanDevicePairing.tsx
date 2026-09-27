import { useState } from 'react';
import { Button, Input } from '@breakery/ui';
import { pairLanDevice, useLanCredential } from '@/features/lan/lanCredential';
import { usePosSettingsStore } from '@/stores/posSettingsStore';
export function LanDevicePairing({ readOnly }: { readOnly: boolean }) {
  const device = useLanCredential((s) => s.credential);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function pair() {
    setBusy(true);
    setError('');
    try {
      const paired = await pairLanDevice(code.trim());
      usePosSettingsStore.getState().setDeviceCode(paired.code);
      setCode('');
    } catch {
      setError('Activation failed. Check the code and your connection.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="LAN device authorization">
      <p className="text-sm">
        {device ? 'Authorized terminal: ' + device.code : 'This terminal is not authorized.'}
      </p>
      <p className="text-sm text-text-secondary">
        Ask a manager for an activation code from Back Office → LAN Devices. Activation requires
        Internet.
      </p>
      <label className="block space-y-1 text-sm">
        Activation code
        <Input
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={readOnly || busy}
          maxLength={32}
        />
      </label>
      <Button disabled={readOnly || busy || !code.trim()} onClick={() => void pair()}>
        {busy ? 'Activating…' : 'Activate terminal'}
      </Button>
      {device && (
        <Button
          variant="secondary"
          disabled={readOnly || busy}
          onClick={() => useLanCredential.getState().setCredential(null)}
        >
          Disconnect this terminal
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-as-text">
          {error}
        </p>
      )}
    </section>
  );
}
