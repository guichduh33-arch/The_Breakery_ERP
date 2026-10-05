import type { ShiftConfig } from './shiftRules';
import { PresencePanel } from './PresencePanel';
import { demoPresence } from './presence';
import type { PresencePunch } from './presence';
import type { Week } from './demoRules';
import { Link } from 'react-router-dom';
import type { Employee, Request } from '../model';
import { money } from '../model';

// Série fictive indépendante du moteur de pointage, en cours de conception.
const days = [
  { label: 'Tue 29', present: 3, leave: 0, absent: 0 },
  { label: 'Wed 30', present: 2, leave: 1, absent: 0 },
  { label: 'Thu 01', present: 2, leave: 0, absent: 1 },
  { label: 'Fri 02', present: 3, leave: 0, absent: 0 },
  { label: 'Sat 03', present: 3, leave: 0, absent: 0 },
  { label: 'Sun 04', present: 2, leave: 1, absent: 0 },
  { label: 'Mon 05', present: 2, leave: 1, absent: 0 },
];

export function Overview({ team, requests, published, week, punches, catalog }: {
  team: Employee[]; requests: Request[]; published: boolean; week: Week; punches: PresencePunch[]; catalog: ShiftConfig[];
}) {
  const rows = demoPresence(team, week, requests, punches, catalog);
  const present = rows.filter(row => ['On work', 'On break', 'Clocked out'].includes(row.status)).length;
  const expected = rows.filter(row => !['Day off', 'On leave', 'No schedule'].includes(row.status)).length;
  const waiting = rows.filter(row => row.status === 'Not clocked in').length;
  const pending = requests.filter((request) => request.status === 'pending');
  const base = team.reduce((total, employee) => total + BigInt(employee.salary), 0n);
  return <div className="hr-stack">
    <div className="hr-overview-heading">
      <div><p className="hr-eyebrow">MONDAY, 05 OCTOBER · WITA</p>
        <h2 className="text-xl font-semibold">Your team, at a glance</h2>
        <p className="hr-muted">Start with attendance, then clear the items needing your attention.</p></div>
      <Link className="hr-overview-link" to="/admin/attendance">Open attendance →</Link>
    </div>
    <div className="hr-operational-kpis">
      <Link to="/admin/attendance" className="hr-card hr-kpi hr-tone-success">
        <p>Present / expected</p><strong className="hr-data">{present} / {expected}</strong>
        <span>Confirmed demo punches / scheduled staff</span></Link>
      <Link to="/admin/attendance" className="hr-card hr-kpi hr-tone-warning">
        <p>Not clocked in</p><strong className="hr-data">{waiting}</strong>
        <span>No confirmed clock-in · demo day</span></Link>
      <Link to="/admin/requests" className="hr-card hr-kpi hr-tone-warning">
        <p>Requests to review</p><strong className="hr-data">{pending.length}</strong>
        <span>Updates with demo decisions</span></Link>
      <Link to="/admin/schedule" className="hr-card hr-kpi hr-tone-gold">
        <p>Weekly schedule</p><strong className="hr-kpi-word">{published ? 'Published' : 'Draft'}</strong>
        <span>{published ? 'Staff can see the published copy' : 'Publish when the shifts are ready'}</span></Link>
    </div>
    <PresencePanel rows={rows} />
    <div className="hr-dashboard-grid">
      <section className="hr-card hr-stack">
        <div><p className="hr-eyebrow">ATTENDANCE</p><h2 className="text-xl font-semibold">The last 7 days</h2>
          <p className="hr-muted">Illustrative series · 3 scheduled employees per day</p></div>
        <div className="hr-chart-legend"><span><i className="hr-chart-present" />Present</span>
          <span><i className="hr-chart-leave" />On leave</span><span><i className="hr-chart-absent" />Unexplained absence</span></div>
        <div className="hr-attendance-chart" role="img" aria-label="Illustrative daily attendance. Counts are listed below.">
          {days.map(day => <div className="hr-chart-day" key={day.label}>
            <div className="hr-chart-column">{(['absent', 'leave', 'present'] as const).map(status =>
              day[status] > 0 && <div key={status} className={'hr-chart-' + status} style={{ flex: day[status] }}>
                {day[status]}</div>)}</div><span className="hr-data">{day.label}</span>
          </div>)}
        </div>
        <details><summary>View chart data</summary><div className="hr-scroll"><table className="hr-table">
          <caption className="hr-muted">Illustrative attendance, 29 September–5 October 2026</caption>
          <thead><tr><th>Day</th><th>Present</th><th>On leave</th><th>Absent</th></tr></thead>
          <tbody>{days.map(day => <tr key={day.label}><th>{day.label}</th><td>{day.present}</td><td>{day.leave}</td><td>{day.absent}</td></tr>)}</tbody>
        </table></div></details>
      </section>
      <section className="hr-card hr-stack">
        <div><p className="hr-eyebrow">ACTION CENTRE</p><h2 className="text-xl font-semibold">Needs your attention</h2></div>
        <Link to="/admin/requests" className="hr-action-row"><span className="hr-status-label hr-tone-warning">{pending.length} pending</span>
          <strong>Review staff requests</strong><span className="hr-muted">Leave, corrections and other submissions →</span></Link>
        <Link to="/admin/schedule" className="hr-action-row"><span className={'hr-status-label ' + (published ? 'hr-tone-success' : 'hr-tone-warning')}>{published ? 'Published' : 'Draft'}</span>
          <strong>Prepare the weekly schedule</strong><span className="hr-muted">Check shifts and publish to the staff app →</span></Link>
        <Link to="/admin/monthly-audit" className="hr-action-row"><span className="hr-status-label hr-tone-gold">Preview</span>
          <strong>Check attendance anomalies</strong><span className="hr-muted">Monthly audit rules are still being designed →</span></Link>
      </section>
    </div>
    <div className="hr-columns">
      <section className="hr-card"><p className="hr-eyebrow">PAYROLL PREPARATION</p>
        <h2 className="text-xl font-semibold">Monthly basic salaries</h2><p className="hr-data text-2xl">{money(base)}</p>
        <p className="hr-muted">{team.length} demo employees · before allowances and deductions</p>
        <Link className="hr-overview-link" to="/admin/payroll">Review payroll inputs →</Link></section>
      <section className="hr-card"><p className="hr-eyebrow">PEOPLE</p>
        <h2 className="text-xl font-semibold">Keep employee records up to date</h2>
        <p className="hr-muted">Review employee profiles, contracts and probation tasks.</p>
        <div className="hr-tabs"><Link className="hr-overview-link" to="/admin/employees">Employees →</Link>
        <Link className="hr-overview-link" to="/admin/contracts-and-tasks">Contracts & tasks →</Link></div></section>
    </div>
  </div>;
}
