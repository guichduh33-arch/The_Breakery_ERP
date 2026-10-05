import { ShiftLibrary } from './ShiftLibrary';
import { initialShifts } from './shiftRules';
import type { ShiftConfig } from './shiftRules';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Select } from '@breakery/ui';
import {
  sampleWeek,
  shifts,
  weekdays,
  daysId,
  changeShift,
  duplicateWeek,
  demoLeaveBalance,
} from './demoRules';
import type { Week } from './demoRules';
import type { Employee, Request } from '../model';
export interface PlanningState {
  draft: Week;
  published: Week | null;
  next: Week | null;
  catalog: ShiftConfig[];
  publishedCatalog: ShiftConfig[] | null;
  shiftChanges: { reason: string; at: string }[];
}
export const initialPlanning: PlanningState = { draft: sampleWeek, published: null, next: null, catalog: initialShifts, publishedCatalog: null, shiftChanges: [] };
export function Planning({
  team,
  staff,
  state,
  setState,
}: {
  team: Employee[];
  staff: boolean;
  state: PlanningState;
  setState: (s: PlanningState) => void;
}) {
  const [tab, setTab] = useState('week');
  const shifts = staff ? (state.publishedCatalog ?? state.catalog) : state.catalog;
  const week = staff ? (state.published ?? state.draft) : state.draft;
  return (
    <div className="hr-stack">
      <div className="hr-toolbar">
        <div>
          <p className="hr-data">05—11 OCT 2026 · WITA</p>
          <p>
            {staff
              ? state.published
                ? 'Jadwal dipublikasikan'
                : 'Contoh jadwal — belum dipublikasikan'
              : state.published
                ? 'Published copy available to staff'
                : 'Draft · not published'}
          </p>
        </div>
        {!staff && (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => setState({ ...state, next: duplicateWeek(state.draft) })}
            >
              Duplicate to next week
            </Button>
            <Button
              variant="ink"
              onClick={() => setState({ ...state, published: duplicateWeek(state.draft), publishedCatalog: state.catalog.map(shift => ({ ...shift })) })}
            >
              Publish demo week
            </Button>
          </div>
        )}
      </div>
      {!staff && (
        <div className="hr-tabs">
          {[
            ['week', 'Weekly schedule'],
            ['shifts', 'Shift library'],
            ['breaks', 'Breaks'],
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
      )}
      {tab === 'week' || staff ? (
        <>
          {staff ? (
            <div className="hr-stack">
              {(week['001'] ?? []).map((code, i) => {
                const shift = shifts.find((s) => s.code === code)!;
                return (
                  <article className="hr-card" key={i}>
                    <strong>{daysId[i]}</strong>
                    <p className="hr-data">{shift.hours}</p>
                    <p>{shift.staffLabel} · {shift.dayOff ? 'Libur' : 'Istirahat ' + shift.break}</p>
                  </article>
                );
              })}
              <Link to="/staff/requests">Ajukan perubahan jadwal →</Link>
            </div>
          ) : (
            <div className="hr-scroll hr-card">
              <table className="hr-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    {weekdays.map((d) => (
                      <th key={d}>{d.slice(0, 3)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {team.map((e) => (
                    <tr key={e.id}>
                      <th>{e.name}</th>
                      {weekdays.map((d, i) => (
                        <td key={d}>
                          <Select
                            aria-label={e.name + ' ' + d + ' shift'}
                            value={week[e.id]?.[i] ?? 'OFF'}
                            onChange={(event) =>
                              setState({
                                ...state,
                                draft: changeShift(state.draft, e.id, i, event.target.value, shifts),
                              })
                            }
                          >
                            {shifts.filter(s => s.active || s.code === week[e.id]?.[i]).map((s) => (
                              <option key={s.code} value={s.code} disabled={!s.active}>
                                {s.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {state.next && !staff && (
            <p role="status">A separate copy for 12–18 October is ready in this demo session.</p>
          )}
        </>
      ) : tab === 'shifts' ? (
        <><ShiftLibrary catalog={state.catalog} onSave={(catalog, reason) => setState({ ...state, catalog, shiftChanges: [...state.shiftChanges, { reason, at: new Date().toISOString() }] })} />
        <details className="hr-card"><summary>Shift change history · {state.shiftChanges.length}</summary>{state.shiftChanges.map((change, index) => <p key={index}>{change.reason} · {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', dateStyle: 'short', timeStyle: 'short' }).format(new Date(change.at))} WITA · Demo HR admin</p>)}<p>Session history only.</p></details></>
      ) : (
        <div className="hr-scroll hr-card">
          <table className="hr-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>{tab === 'breaks' ? 'Break' : 'Working window'}</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.code}>
                  <td className="hr-data">{s.code}</td>
                  <td>{s.label}</td>
                  <td className="hr-data">{tab === 'breaks' ? s.break : s.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.next && !staff && (
        <details className="hr-card">
          <summary className="cursor-pointer">Next week copy · 12–18 October</summary>
          <div className="hr-scroll">
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  {weekdays.map((d) => (
                    <th key={d}>{d.slice(0, 3)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {team.map((e) => (
                  <tr key={e.id}>
                    <th>{e.name}</th>
                    {(state.next?.[e.id] ?? []).map((code, i) => (
                      <td key={i}>{shifts.find((s) => s.code === code)?.hours}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="hr-subtitle">
        {staff
          ? 'Jadwal dan perubahan hanya contoh.'
          : 'Conflict checks and statutory hours alerts await the attendance engine. Shift time ranges are validated when saved.'}
      </p>
    </div>
  );
}
const attendance = [
  {
    id: '001',
    date: '2026-10-04',
    shift: 'MORNING',
    in: '06:28',
    out: '14:31',
    break: '10:31–11:30',
    status: 'On time',
  },
  {
    id: '030',
    date: '2026-10-04',
    shift: 'BAKER',
    in: '02:01',
    out: '—',
    break: '05:00–06:00',
    status: 'No clock out',
  },
  {
    id: '042',
    date: '2026-10-04',
    shift: 'AFTERNOON',
    in: '10:42',
    out: '18:31',
    break: '13:32–14:40',
    status: 'Late clock in',
  },
];
export function Attendance({ team }: { team: Employee[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [breaks, setBreaks] = useState(true);
  const rows = attendance.filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      (team.find((e) => e.id === r.id)?.name ?? '').toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="hr-stack">
      <div className="hr-kpis">
        {[
          ['1', 'On time'],
          ['1', 'Late clock in'],
          ['1', 'No clock out'],
        ].map(([n, l]) => (
          <div className="hr-card" key={l}>
            <span className="hr-data text-3xl">{n}</span>
            <p>{l}</p>
          </div>
        ))}
      </div>
      <div className="hr-toolbar">
        <label>
          Search employee
          <Input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          Attendance status
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {['all', 'On time', 'Late clock in', 'No clock out'].map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s}
              </option>
            ))}
          </Select>
        </label>
        <Button variant="secondary" onClick={() => setBreaks(!breaks)}>
          {breaks ? 'Hide break column' : 'Show break column'}
        </Button>
      </div>
      <div className="hr-scroll hr-card">
        <table className="hr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th>Shift</th>
              <th>Schedule</th>
              <th>Clock in</th>
              <th>Clock out</th>
              {breaks && <th>Actual break</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th>{team.find((e) => e.id === r.id)?.name}</th>
                <td>{r.date}</td>
                <td>{r.shift}</td>
                <td className="hr-data">{shifts.find((s) => s.code === r.shift)?.hours}</td>
                <td>{r.in}</td>
                <td>{r.out}</td>
                {breaks && <td>{r.break}</td>}
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p>No attendance matches these filters.</p>}
      </div>
      <Link to="/admin/requests">Review attendance corrections →</Link>
      <p>
        Sample read-only records. Import, locking and audited corrections require the dedicated
        backend.
      </p>
    </div>
  );
}
export function Leave({ requests, staff }: { requests: Request[]; staff: boolean }) {
  return (
    <div className="hr-stack">
      <div className="hr-card">
        <p>{staff ? 'Saldo cuti contoh' : 'Sample annual leave balance'}</p>
        <span className="hr-data text-3xl">
          {demoLeaveBalance(requests, '001')} {staff ? 'hari' : 'days'}
        </span>
        <p>
          {staff
            ? 'Saldo awal contoh: 12 hari. Bukan hak cuti resmi.'
            : 'Illustrative opening balance: 12 days. Each approved one-day demo leave is counted once.'}
        </p>
      </div>
      <div className="hr-scroll hr-card">
        <table className="hr-table">
          <thead>
            <tr>
              <th>{staff ? 'Jenis' : 'Policy'}</th>
              <th>{staff ? 'Saldo' : 'Balance'}</th>
              <th>{staff ? 'Dokumen' : 'Documents'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cuti</td>
              <td>{staff ? 'Tahunan · contoh' : 'Annual · demo'}</td>
              <td>{staff ? 'Opsional' : 'Optional'}</td>
            </tr>
            <tr>
              <td>Sakit</td>
              <td>{staff ? 'Belum ditetapkan' : 'Not configured'}</td>
              <td>{staff ? 'Surat dokter' : 'Medical certificate'}</td>
            </tr>
            <tr>
              <td>Izin</td>
              <td>{staff ? 'Belum ditetapkan' : 'Not configured'}</td>
              <td>{staff ? 'Sesuai permintaan HR' : 'As requested by HR'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Link to={staff ? '/staff/requests' : '/admin/requests'}>
        {staff ? 'Ajukan atau lihat permintaan →' : 'Review leave requests →'}
      </Link>
      <p>
        {staff
          ? 'Ketentuan cuti, carry-over dan masa berlaku akan ditetapkan HR.'
          : 'Accrual, carry-over, expiry, eligibility and payroll impact will be configured after rule approval.'}
      </p>
    </div>
  );
}
