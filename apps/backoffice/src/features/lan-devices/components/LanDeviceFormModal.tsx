// apps/backoffice/src/features/lan-devices/components/LanDeviceFormModal.tsx
// Create/edit d'un lan_device (spec §5.1). Station visible seulement pour les
// imprimantes ; capabilities mergées (jamais écrasées) ; warning non bloquant
// si une autre imprimante active porte déjà la station (useStationPrinters
// n'en garde qu'une par station côté POS).
import { useEffect, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  Button, Input,
} from '@breakery/ui';
import type { LanDeviceRow, LanDeviceType } from '../hooks/useLanDevices.js';
import { useUpsertLanDevice } from '../hooks/useUpsertLanDevice.js';

const DEVICE_TYPES: LanDeviceType[] = ['printer', 'kds', 'tablet', 'pos', 'kiosk_display'];
const STATIONS = ['kitchen', 'barista', 'display', 'cashier', 'waiter'] as const;

export interface LanDeviceFormModalProps {
  open: boolean;
  onClose: () => void;
  device: LanDeviceRow | null; // non-null = edit
  prefill: { ip_address: string; port: number } | null; // depuis le scan
  allDevices: LanDeviceRow[];
}

export function LanDeviceFormModal({ open, onClose, device, prefill, allDevices }: LanDeviceFormModalProps): JSX.Element {
  const upsert = useUpsertLanDevice();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [deviceType, setDeviceType] = useState<LanDeviceType>('printer');
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('');
  const [location, setLocation] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [station, setStation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setCode(device?.code ?? '');
    setName(device?.name ?? '');
    setDeviceType(device?.device_type ?? 'printer');
    setIp(device?.ip_address ?? prefill?.ip_address ?? '');
    setPort(device?.port !== null && device?.port !== undefined ? String(device.port) : prefill ? String(prefill.port) : '');
    setLocation(device?.location ?? '');
    setIsActive(device?.is_active ?? true);
    const stationCap = device?.capabilities?.station;
    setStation(typeof stationCap === 'string' ? stationCap : '');
  }, [open, device, prefill]);

  const stationConflict = useMemo(() => {
    if (deviceType !== 'printer' || station === '' || !isActive) return null;
    return allDevices.find(
      (d) => d.id !== device?.id && d.device_type === 'printer' && d.is_active
        && d.deleted_at === null && d.capabilities?.station === station,
    ) ?? null;
  }, [allDevices, device?.id, deviceType, station, isActive]);

  function submit(): void {
    if (code.trim() === '' || name.trim() === '') {
      setFormError('Code and name are required.');
      return;
    }
    const portNum = port.trim() === '' ? null : Number(port);
    if (deviceType === 'printer' && (ip.trim() === '' || portNum === null || !Number.isInteger(portNum))) {
      setFormError('IP address and port are required for printers.');
      return;
    }
    upsert.mutate(
      {
        ...(device !== null ? { id: device.id, existingCapabilities: device.capabilities } : {}),
        code, name, device_type: deviceType,
        ip_address: ip.trim() === '' ? null : ip.trim(),
        port: portNum,
        location: location.trim() === '' ? null : location.trim(),
        is_active: isActive,
        station: deviceType === 'printer' && station !== '' ? station : null,
      },
      {
        onSuccess: () => { toast.success(device !== null ? 'Device updated' : 'Device added'); onClose(); },
        onError: (err) => {
          setFormError(err.message === 'code_taken' ? 'This device code is already in use.' : err.message);
        },
      },
    );
  }

  const selectCls = 'w-full rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-sm';
  const labelCls = 'block font-bold uppercase tracking-widest text-text-muted text-xs mb-1';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{device !== null ? 'Edit device' : 'Add device'}</DialogTitle>
          <DialogDescription>
            Registered devices drive heartbeats, KDS and station printing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="dev-code" className={labelCls}>Code</label>
            <Input id="dev-code" aria-label="Code" placeholder="e.g. PRN-KITCHEN-1"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div>
            <label htmlFor="dev-name" className={labelCls}>Name</label>
            <Input id="dev-name" aria-label="Name" placeholder="e.g. Kitchen printer"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="dev-type" className={labelCls}>Device type</label>
            <select id="dev-type" aria-label="Device type" className={selectCls}
              value={deviceType} onChange={(e) => setDeviceType(e.target.value as LanDeviceType)}>
              {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dev-ip" className={labelCls}>IP address</label>
              <Input id="dev-ip" aria-label="IP address" placeholder="192.168.1.60"
                value={ip} onChange={(e) => setIp(e.target.value)} />
            </div>
            <div>
              <label htmlFor="dev-port" className={labelCls}>Port</label>
              <Input id="dev-port" aria-label="Port" placeholder="9100" inputMode="numeric"
                value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>
          {deviceType === 'printer' && (
            <div>
              <label htmlFor="dev-station" className={labelCls}>Station</label>
              <select id="dev-station" aria-label="Station" className={selectCls}
                value={station} onChange={(e) => setStation(e.target.value)}>
                <option value="">— none —</option>
                {STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {stationConflict !== null && (
                <p className="text-xs text-warning mt-1">
                  Station "{station}" is already assigned to {stationConflict.code}. Only one active
                  printer per station is used by the POS.
                </p>
              )}
            </div>
          )}
          <div>
            <label htmlFor="dev-location" className={labelCls}>Location</label>
            <Input id="dev-location" aria-label="Location" placeholder="e.g. kitchen"
              value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
          {formError !== null && <p className="text-sm text-danger">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={upsert.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
