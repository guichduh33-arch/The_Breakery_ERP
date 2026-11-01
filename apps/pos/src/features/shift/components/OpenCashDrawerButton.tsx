import { useRef, useState } from 'react';
import { Button } from '@breakery/ui';
import { openCashDrawer } from '@/services/print/printService';

export function OpenCashDrawerButton() {
  const pending = useRef(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen(): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setOpening(true);
    setError(null);
    try {
      const result = await openCashDrawer();
      if (!result.success) setError('Could not open cash drawer. Check the printer connection and try again.');
    } catch {
      setError('Could not open cash drawer. Check the printer connection and try again.');
    } finally {
      pending.current = false;
      setOpening(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" size="lg" className="w-full" disabled={opening}
        onClick={() => { void handleOpen(); }}>
        {opening ? 'Opening drawer…' : 'Open cash drawer'}
      </Button>
      {error && <p role="alert" className="text-sm text-danger-as-text">{error}</p>}
    </div>
  );
}
