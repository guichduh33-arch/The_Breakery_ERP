// apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx
// S14 (read-only + KPIs) → 2026-07-06 : + CRUD (form modal). Route gated
// lan.devices.read (inchangé) ; écritures gated lan.devices.manage.
//
// ADR-030 — le back-office est publié en HTTPS : il ne peut plus joindre le
// print-bridge, qui écoute en clair sur le réseau local. L'état du hub, le
// balayage réseau et le test d'imprimante ont donc quitté cette page pour
// POS » Settings » Devices. Ce qui reste ici est le registre lui-même, qui est
// une donnée cloud et se gère aussi bien à distance.
import { useMemo, useState } from 'react';
import { Wifi, CheckCircle2, AlertTriangle, Printer, Plus } from 'lucide-react';
import { Button, Card, KpiTile } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';
import { useAuthStore } from '@/stores/authStore.js';
import { LanDevicesTable } from '@/features/lan-devices/components/LanDevicesTable.js';
import { OfflineSettingsPanel } from '@/features/lan-devices/components/OfflineSettingsPanel.js';
import { LanDeviceFormModal } from '@/features/lan-devices/components/LanDeviceFormModal.js';
import { useLanDevices, type LanDeviceRow } from '@/features/lan-devices/hooks/useLanDevices.js';
import { PageHeader } from '@/components/PageHeader.js';

export default function LanDevicesPage() {
  const { data } = useLanDevices();
  const canManage = useAuthStore((s) => s.hasPermission('lan.devices.manage'));
  const rows = useMemo(() => data ?? [], [data]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LanDeviceRow | null>(null);

  const kpis = useMemo(() => {
    const now = Date.now();
    let online = 0;
    let stale = 0;
    let printers = 0;
    for (const d of rows) {
      const isStale = d.last_heartbeat_at === null
        ? true
        : now - new Date(d.last_heartbeat_at).getTime() > 60_000;
      if (isStale) stale++;
      else online++;
      if (d.device_type === 'printer') printers++;
    }
    return { total: rows.length, online, stale, printers };
  }, [rows]);

  function openCreate(): void { setEditing(null); setModalOpen(true); }
  function openEdit(device: LanDeviceRow): void { setEditing(device); setModalOpen(true); }

  return (
    <div className="space-y-6">
      <PageHeader
        className="items-start"
        title="LAN Devices"
        subtitle="Devices participating in the on-site LAN mesh. Status is computed from the last heartbeat — devices that haven't pinged in 60s are flagged as stale."
        actions={canManage ? (
          <Button variant="ink" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Add device
          </Button>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Total devices" value={kpis.total}    icon={Wifi}           footer="Registered in the mesh" />
        <KpiTile label="Online"        value={kpis.online}   icon={CheckCircle2}   footer="Heartbeat within 60s" />
        <KpiTile label="Stale"         value={kpis.stale}    icon={AlertTriangle}  footer="No recent heartbeat" />
        <KpiTile label="Printers"      value={kpis.printers} icon={Printer}        footer="ESC/POS printers in mesh" />
      </div>

      {/* ADR-015 — activation de l'encaissement hors-ligne (catégorie network,
          clé unique offline_payments_enabled : la fenêtre de durée est supprimée). */}
      <Card padding="md" className="space-y-3">
        <SectionLabel size="sm" as="h2">Mode hors-ligne</SectionLabel>
        <OfflineSettingsPanel />
      </Card>

      <Card padding="md">
        <LanDevicesTable onEdit={openEdit} />
      </Card>

      {/* ADR-030 — ces gestes touchent le réseau local, qu'une page HTTPS ne peut
          pas joindre. Ils vivent désormais sur le terminal, servi en local. */}
      <Card padding="md" className="space-y-2">
        <SectionLabel size="sm" as="h2">Hub, network scan and printer tests</SectionLabel>
        <p className="text-sm text-text-secondary">
          These live on the terminal, under POS &raquo; Settings &raquo; Devices.
          They talk to the print-bridge over the shop network, which a page served
          over HTTPS cannot reach.
        </p>
      </Card>

      <LanDeviceFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        device={editing}
        allDevices={rows}
      />
    </div>
  );
}
