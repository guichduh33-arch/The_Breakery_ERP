import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Select } from '@breakery/ui';
import type { Employee, Request } from '../model';
import type { PresenceRow } from './presence';
import { employeeFields, employeeGroups, updateEmployeeDetails } from './employeeFields';
import { money } from '../model';
export function EmployeeDetails({ employee, team, setTeam, run, presence, requests }: {
  employee: Employee; team: Employee[]; setTeam: (team: Employee[]) => void;
  run: (fn: () => void) => void; presence: PresenceRow | undefined; requests: Request[];
}) {
  const [tab, setTab] = useState('Employment');
  const [editing, setEditing] = useState(false);
  const fields = employeeFields.filter(field => field.group === tab);
  return <section className="hr-card hr-stack">
    <div className="hr-toolbar"><div><p className="hr-eyebrow">EMPLOYEE RECORD · {employee.id}</p>
      <h2 className="text-xl font-semibold">{employee.name}</h2><p className="hr-muted">{employee.position} · {employee.details?.department ?? 'Department not provided'}</p></div>
      <span className="hr-status-label hr-tone-gold">Fictional profile · demo only</span></div>
    <div className="hr-tabs" aria-label="Employee profile sections">{employeeGroups.map(group =>
      <Button key={group} variant={group === tab ? 'ink' : 'secondary'} aria-pressed={group === tab}
        onClick={() => { setTab(group); setEditing(false); }}>{group}</Button>)}</div>
    {tab === 'Attendance' ? <div className="hr-stack">
      <div className="hr-columns"><div><p className="hr-eyebrow">PRESENCE · DEMO DAY 05 OCT</p><h3 className="text-xl font-semibold">{presence?.status ?? 'No schedule'}</h3>
        <p>{presence?.shift}</p><p>{presence?.lastEvent} · {presence?.time} WITA</p><p className="hr-muted">{presence?.source} · {presence?.pending ?? 0} pending sync</p></div>
      <div><p className="hr-eyebrow">REQUESTS IN THIS SESSION</p><p>{requests.filter(item => item.employee === employee.id && item.status === 'pending').length} pending requests</p>
        <p>{requests.filter(item => item.employee === employee.id && item.status === 'approved').length} approved requests</p><Link to="/admin/requests">Review requests →</Link></div></div>
      <p className="hr-muted">Monthly days worked, absences, lateness, break overruns and overtime await the audit engine and imported attendance. No monthly totals are invented.</p>
      <Link to="/admin/attendance">Open attendance records →</Link></div> : <>
      {tab === 'Tax & BPJS' && <p className="hr-muted">PTKP is recorded explicitly and is independent of family details. Tax methods and BPJS fields are not connected to payroll calculations yet.</p>}
      {tab === 'Pay & bank' && <p className="hr-data">Basic salary · {money(employee.salary)}</p>}
      {tab === 'Documents' && <p className="hr-muted">Use fictional identifiers only. Private file upload and document verification will be available with the dedicated backend.</p>}
      {editing ? <form className="hr-stack" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        const readField = (key: string) => { const value = data.get(key); return typeof value === 'string' ? value : ''; };
        const values = Object.fromEntries(fields.map(field => [field.key, readField(field.key)]));
        run(() => { setTeam(updateEmployeeDetails(team, employee.id, values, readField('reason'), new Date().toISOString())); setEditing(false); });
      }}><div className="hr-profile-fields">{fields.map(field => <label key={field.key}>{field.label}
        {field.options ? <Select name={field.key} defaultValue={employee.details?.[field.key] ?? ''}><option value="">Not provided</option>
          {field.options.map(option => <option key={option}>{option}</option>)}</Select>
          : <Input name={field.key} defaultValue={employee.details?.[field.key] ?? ''} type={['date', 'email'].includes(field.type ?? '') ? field.type : 'text'}
            inputMode={['count', 'money', 'nik'].includes(field.type ?? '') ? 'numeric' : undefined} maxLength={field.type === 'nik' ? 16 : 500} placeholder="Not provided" />}</label>)}</div>
        <label className="hr-form">Change reason<Input name="reason" required maxLength={500} placeholder="Why are these details being updated?" /></label>
        <div className="hr-tabs"><Button variant="ink">Save profile section</Button><Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div>
      </form> : <><dl className="hr-profile-fields">{fields.map(field => <div key={field.key}><dt className="hr-muted">{field.label}</dt>
        <dd>{employee.details?.[field.key] ?? 'Not provided'}</dd></div>)}</dl><Button variant="secondary" onClick={() => setEditing(true)}>Edit {tab.toLowerCase()}</Button></>}
    </>}
    <details><summary>Profile change history · {employee.profileChanges?.length ?? 0}</summary>
      {!employee.profileChanges?.length && <p className="hr-muted">No changes in this demo session.</p>}
      {employee.profileChanges?.map((change, index) => <div className="hr-profile-history" key={index}><strong>{change.actor}</strong>
        <p>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Makassar', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(change.at))} WITA · {change.reason}</p>
        <p className="hr-muted">Changed: {change.fields.join(', ')}</p></div>)}
      <p className="hr-muted">Session history only · durable audit logs will require the dedicated backend.</p></details>
  </section>;
}
