import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from '@breakery/ui';
const groups: Record<string, [string, string, string][]> = {
  Company: [
    ['company', 'Company name', 'The Breakery'],
    ['city', 'City', 'Lombok'],
    ['signer', 'Document signer', 'Demo HR manager'],
  ],
  Attendance: [
    ['late', 'Late tolerance · minutes', '0'],
    ['break', 'Break tolerance · minutes', '15'],
    ['latePenalty', 'Flat lateness deduction · IDR', '25000'],
    ['breakPenalty', 'Flat break deduction · IDR', '25000'],
  ],
  Leave: [
    ['accrual', 'Accrual cycle', 'Awaiting approval'],
    ['carry', 'Carry-over & expiry', 'Awaiting approval'],
    ['medical', 'Medical documents', 'Awaiting approval'],
  ],
  Payroll: [
    ['divisor', 'Day divisor', '26'],
    ['hours', 'Hours per day', '7'],
    ['meal', 'Meal allowance · IDR', '15000'],
    ['cap', 'Deduction cap ratio', '0.5'],
    ['cutoff', 'Payroll cut-off', 'Awaiting approval'],
    ['payment', 'Payment date', 'Awaiting approval'],
  ],
  'Service charge': [
    ['scMode', 'Pool / point mode', 'pool'],
    ['pool', 'Monthly pool · IDR', '0'],
    ['point', 'Point value · IDR', '38500'],
  ],
  'BPJS & tax': [
    ['invoice', 'Kesehatan invoice · IDR', 'Not provided'],
    ['bpjs', 'BPJS membership & base', 'Per employee'],
    ['tax', 'PPh 21 calculation', 'Pending tax hook'],
  ],
  THR: [
    ['tenure', 'Tenure basis & prorating', 'Awaiting approval'],
    ['round', 'Rounding', 'Awaiting approval'],
    ['resign', 'Resignation eligibility', 'Awaiting approval'],
  ],
  'Access & approvals': [
    ['approval', 'Request approver', 'Admin / HR'],
    ['documents', 'Document visibility', 'Private · dedicated backend pending'],
    ['clock', 'Clock identification & offline rules', 'Awaiting approval'],
  ],
};
export function SettingsPanel() {
  const [group, setGroup] = useState('Company');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  return (
    <div className="hr-stack">
      <p>
        Draft parameter inventory inspired by Talenta. These values do not change payroll formulas
        or establish legal policies. Versioning and date-effect enforcement require the dedicated
        backend.
      </p>
      <div className="hr-tabs">
        {Object.keys(groups).map((g) => (
          <Button
            key={g}
            variant={g === group ? 'ink' : 'secondary'}
            onClick={() => {
              setGroup(g);
              setSaved(false);
            }}
          >
            {g}
          </Button>
        ))}
      </div>
      <form
        className="hr-form hr-card"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(true);
        }}
      >
        <h2 className="text-xl font-semibold">{group}</h2>
        <label>
          Effective month
          <Input type="month" defaultValue="2026-10" required />
        </label>
        {groups[group]!.map(([key, label, defaultValue]) => (
          <label key={key}>
            {label}
            <Input
              value={values[key] ?? defaultValue}
              onChange={(e) => {
                setValues({ ...values, [key]: e.target.value });
                setSaved(false);
              }}
              required
            />
          </label>
        ))}
        <p>Deployment timezone · Asia/Makassar (WITA)</p>
        <Button variant="ink">Save demo draft</Button>
        {saved && <p role="status">Draft values saved in this screen. Reload resets the demo.</p>}
      </form>
    </div>
  );
}
const announcements = [
  {
    id: 1,
    title: 'Jadwal minggu depan',
    text: 'Contoh: periksa jadwal yang sudah dipublikasikan dan ajukan perubahan melalui aplikasi.',
  },
  {
    id: 2,
    title: 'Permintaan dan dokumen',
    text: 'Contoh: sertakan alasan yang jelas untuk permintaan cuti atau koreksi absensi.',
  },
];
export function Announcements({
  staff,
  ack,
  setAck,
}: {
  staff: boolean;
  ack: number[];
  setAck: (value: number[]) => void;
}) {
  return (
    <div className="hr-stack">
      {announcements.map((a) => (
        <article lang="id" className="hr-card hr-stack" key={a.id}>
          <h2 className="text-xl font-semibold">{a.title}</h2>
          <p>{a.text}</p>
          {staff ? (
            <Button
              variant="secondary"
              disabled={ack.includes(a.id)}
              onClick={() => setAck([...ack, a.id])}
            >
              {ack.includes(a.id) ? 'Sudah dibaca' : 'Tandai sudah dibaca'}
            </Button>
          ) : (
            <span>Employee-facing sample · Indonesian</span>
          )}
        </article>
      ))}
      <p>
        {staff
          ? 'Pengumuman ini hanya contoh.'
          : 'Announcements and acknowledgements are simulated. Publication to real employees is not connected.'}
      </p>
    </div>
  );
}
export function Documents({ staff }: { staff: boolean }) {
  const [tab, setTab] = useState('personal');
  return (
    <div className="hr-stack">
      <div className="hr-tabs">
        {[
          ['personal', staff ? 'Dokumen pribadi' : 'Employee documents'],
          ['company', staff ? 'Dokumen perusahaan' : 'Company templates'],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? 'ink' : 'secondary'}
            onClick={() => setTab(key!)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="hr-card">
        <h2 className="text-xl font-semibold">
          {tab === 'personal'
            ? staff
              ? 'Kontrak & surat'
              : 'Contracts & letters'
            : staff
              ? 'Peraturan & panduan'
              : 'Policies & templates'}
        </h2>
        <p>{staff ? 'Belum ada dokumen contoh yang tersedia.' : 'No demo documents available.'}</p>
        <p>
          {staff
            ? 'Unggah, tanda tangan dan unduhan dokumen akan tersedia setelah penyimpanan privat diaktifkan.'
            : 'Private storage, document access, signing and downloads will be added with the dedicated backend.'}
        </p>
      </div>
    </div>
  );
}
export function Calendar({ staff }: { staff: boolean }) {
  return (
    <div className="hr-stack">
      <p className="hr-data">{staff ? 'OKTOBER 2026 · WITA' : 'OCTOBER 2026 · WITA'}</p>
      <div className="hr-card">
        <h2>{staff ? 'Kalender tim contoh' : 'Sample team calendar'}</h2>
        <p>5–11 Oct · {staff ? 'Jadwal mingguan' : 'Weekly schedule'}</p>
        <p>8 Oct · {staff ? 'Permintaan cuti menunggu persetujuan' : 'Pending leave request'}</p>
        <p>
          {staff
            ? 'Hari libur nasional belum dikonfigurasi.'
            : 'Public holidays and approved leave overlays are not configured yet.'}
        </p>
      </div>
      <Link to={staff ? '/staff/schedule' : '/admin/schedule'}>
        {staff ? 'Lihat jadwal →' : 'Open weekly schedule →'}
      </Link>
    </div>
  );
}
export function Overtime() {
  return (
    <div className="hr-stack">
      <div className="hr-card">
        <h2 className="text-xl font-semibold">Overtime approval</h2>
        <p>
          Requested hours and approved hours are separate. Late check-out is never automatically
          paid in this demo.
        </p>
        <Link to="/admin/requests">Review overtime requests →</Link>
      </div>
      <div className="hr-card">
        <h2>Overtime policies</h2>
        <p>
          Weekday, day-off and holiday rates, maximum hours and compensation leave will be
          configured before the payroll engine is connected.
        </p>
        <Link to="/admin/settings">Review policy drafts →</Link>
      </div>
    </div>
  );
}
export function EmployeeProfile() {
  const [tab, setTab] = useState('Pribadi');
  return (
    <div className="hr-stack">
      <div className="hr-tabs">
        {['Pribadi', 'Pekerjaan', 'Kontak darurat', 'Dokumen'].map((t) => (
          <Button variant={t === tab ? 'primary' : 'secondary'} key={t} onClick={() => setTab(t)}>
            {t}
          </Button>
        ))}
      </div>
      <div className="hr-card">
        <h2 className="text-xl font-semibold">Dewi Lestari · 001</h2>
        {tab === 'Pribadi' ? (
          <p>Profil contoh · Kasir · Data fiktif</p>
        ) : tab === 'Pekerjaan' ? (
          <p>Aktif · Karyawan tetap · Informasi kontrak contoh</p>
        ) : tab === 'Kontak darurat' ? (
          <p>Belum ada kontak darurat dalam demo.</p>
        ) : (
          <Link to="/staff/documents">Lihat dokumen pribadi →</Link>
        )}
        <p>Perubahan data pribadi akan diajukan kepada HR. Belum terhubung ke data asli.</p>
      </div>
    </div>
  );
}
export function Lifecycle() {
  return (
    <div className="hr-stack">
      <div className="hr-card">
        <h2>Contracts & probation</h2>
        <p>
          No sample expiry alerts. Contract dates and reminders will be based on the employee
          reference data.
        </p>
      </div>
      <div className="hr-card">
        <h2>Onboarding & offboarding</h2>
        <p>
          Checklist preview: employee profile, account access, documents, payroll setup and return
          of company assets.
        </p>
        <Link to="/admin/employees">Open employee directory →</Link>
      </div>
    </div>
  );
}
