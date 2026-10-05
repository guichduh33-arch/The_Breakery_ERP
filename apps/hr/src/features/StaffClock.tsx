import { Link } from 'react-router-dom';
import { Button } from '@breakery/ui';
import { punchLabels } from '../model';
export interface Punch {
  label: string;
  time: string;
  synced: boolean;
}
interface Props {
  punches: Punch[];
  employeeName: string;
  workingWindow: string;
  setPunches: (p: Punch[]) => void;
  offline: boolean;
  setOffline: (value: boolean) => void;
}
export function StaffClock({ punches, setPunches, offline, setOffline, employeeName, workingWindow }: Props) {
  return (
    <div className="hr-stack">
      <div className="hr-card">
        <p>Selamat datang, {employeeName}</p>
        <h2 className="hr-data text-3xl">{workingWindow}</h2>
        <p>Waktu contoh · WITA. Bukan waktu server.</p>
        <Button variant="secondary" onClick={() => setOffline(!offline)}>
          {offline ? 'Simulasi online' : 'Simulasi offline'}
        </Button>
        <p>{offline ? 'Offline · absensi contoh menunggu' : 'Online · mode demonstrasi'}</p>
        <div className="grid grid-cols-2 gap-3">
          {punchLabels.map((label, i) => (
            <Button
              className="min-h-[68px] whitespace-normal px-2 text-sm"
              key={label}
              disabled={i !== punches.length}
              onClick={() =>
                setPunches([
                  ...punches,
                  {
                    label,
                    time: new Intl.DateTimeFormat('id-ID', {
                      timeZone: 'Asia/Makassar',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date()),
                    synced: !offline,
                  },
                ])
              }
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="hr-card">
        <h2>Riwayat absensi contoh</h2>
        {punches.length === 0 ? (
          <p>Belum ada absensi.</p>
        ) : (
          punches.map((p) => (
            <p key={p.label}>
              {p.label} · {p.time} ·{' '}
              {p.synced ? 'Tercatat dalam demo' : 'Menunggu simulasi sinkronisasi'}
            </p>
          ))
        )}
        {!offline && punches.some((p) => !p.synced) && (
          <Button onClick={() => setPunches(punches.map((p) => ({ ...p, synced: true })))}>
            Simulasikan sinkronisasi
          </Button>
        )}
        <p>Data hanya di memori. Tidak ada pengiriman ke server.</p>
      </div>
      <Link to="/staff/requests">Ajukan cuti atau koreksi →</Link>
    </div>
  );
}
