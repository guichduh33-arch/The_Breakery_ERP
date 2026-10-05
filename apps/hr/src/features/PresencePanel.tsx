import { useState } from 'react';
import { Input, Select } from '@breakery/ui';
import { presenceStatuses } from './presence';
import type { PresenceRow, PresenceStatus } from './presence';
const tones: Record<PresenceStatus, string> = {
  'On work': 'success', 'On break': 'warning', 'Day off': 'neutral', 'On leave': 'gold',
  'Not clocked in': 'warning', 'Clocked out': 'neutral', 'No schedule': 'neutral',
};
export function PresencePanel({ rows }: { rows: PresenceRow[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const filtered = rows.filter(row => (status === 'all' || row.status === status)
    && (row.employee.name + ' ' + row.employee.id + ' ' + row.employee.position).toLowerCase().includes(query.toLowerCase()));
  return <section className="hr-card hr-stack">
    <div className="hr-toolbar"><div><p className="hr-eyebrow">TEAM PRESENCE</p>
      <h2 className="text-xl font-semibold">Who is working now?</h2>
      <p className="hr-muted">Demo day · 05 Oct 2026 · WITA. Dewi updates from staff actions in this session; other punches are illustrative.</p></div>
      <span className="hr-status-label hr-tone-success">Session updates · no server connection</span></div>
    <div className="hr-presence-counts">{presenceStatuses.map(item => <span key={item} className={'hr-status-label hr-tone-' + tones[item]}>
      {item} <strong className="hr-data">{rows.filter(row => row.status === item).length}</strong></span>)}</div>
    <div className="hr-toolbar"><label>Search staff<Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, employee ID or position" /></label>
      <label>Presence status<Select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>
        {presenceStatuses.map(item => <option key={item}>{item}</option>)}</Select></label></div>
    <div className="hr-scroll"><table className="hr-table"><thead><tr><th>Employee</th><th>Status</th><th>Shift</th><th>Last confirmed activity</th><th>Source / sync</th></tr></thead>
      <tbody>{filtered.map(row => <tr key={row.employee.id}><td><strong>{row.employee.name}</strong><div className="hr-muted">{row.employee.id} · {row.employee.position}</div></td>
        <td><span className={'hr-status-label hr-tone-' + tones[row.status]}>{row.status}</span></td><td>{row.shift}</td>
        <td>{row.lastEvent}<div className="hr-data hr-muted">{row.time}{row.time !== '—' && ' WITA'}</div></td>
        <td>{row.source}{row.pending > 0 && <div className="hr-sync-pending">{row.pending} punch(es) awaiting sync</div>}</td></tr>)}</tbody>
    </table>{filtered.length === 0 && <p role="status">No staff match these filters.</p>}</div>
    <p className="hr-muted">A missing punch is shown as “Not clocked in”; it is not automatically classified as an absence. {rows.length} employees · {filtered.length} shown.</p>
  </section>;
}
