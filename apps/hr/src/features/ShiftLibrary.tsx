import { useState } from 'react';
import { Button, Input, Select } from '@breakery/ui';
import { blankShift, saveShift } from './shiftRules';
import type { ShiftConfig } from './shiftRules';
export function ShiftLibrary({ catalog, onSave }: { catalog: ShiftConfig[]; onSave: (shifts: ShiftConfig[], reason: string) => void }) {
  const [draft, setDraft] = useState<ShiftConfig | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState(''); const [error, setError] = useState('');
  const update = (key: keyof ShiftConfig, value: string | boolean) => setDraft(previous => previous ? { ...previous, [key]: value } : previous);
  const begin = (shift: ShiftConfig, code: string | null) => { setDraft({ ...shift }); setEditing(code); setReason(''); setError(''); };
  return <div className="hr-stack">
    <div className="hr-toolbar"><div><h2 className="text-xl font-semibold">Shift library</h2><p className="hr-muted">Create working shifts and days off · all times in WITA.</p></div>
      <Button variant="ink" onClick={() => begin(blankShift, null)}>Create shift</Button></div>
    <div className="hr-card hr-scroll"><table className="hr-table"><thead><tr><th>Code / name</th><th>Working window</th><th>Break</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {catalog.map(shift => <tr key={shift.code}><td><strong>{shift.label}</strong><div className="hr-data hr-muted">{shift.code} · {shift.staffLabel}</div></td>
        <td>{shift.hours}</td><td>{shift.breakMode === 'flexible' ? 'Flexible · ' : ''}{shift.break}</td><td>{shift.active ? 'Active' : 'Inactive'}</td>
        <td><div className="hr-tabs"><Button variant="secondary" onClick={() => begin(shift, shift.code)}>Edit {shift.code}</Button>
          <Button variant="secondary" onClick={() => begin({ ...shift, code: '', label: shift.label + ' copy' }, null)}>Duplicate {shift.code}</Button></div></td></tr>)}</tbody></table></div>
    {draft && <form className="hr-card hr-stack" onSubmit={event => { event.preventDefault(); try {
      if (!reason.trim()) throw new Error('A change reason is required.'); onSave(saveShift(catalog, draft, editing), reason.trim()); setDraft(null); setError('');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Invalid shift.'); } }}>
      <h2 className="text-xl font-semibold">{editing ? 'Edit shift · ' + editing : 'Create shift'}</h2>
      {error && <p role="alert" className="hr-sync-pending">{error}</p>}
      <div className="hr-profile-fields">
        {(['code', 'label', 'staffLabel'] as const).map((key, index) => <label key={key}>{['Unique code', 'Admin name · English', 'Staff name · Indonesian'][index]}
          <Input value={draft[key]} onChange={event => update(key, event.target.value)} required readOnly={key === 'code' && editing !== null} maxLength={key === 'code' ? 32 : 100} /></label>)}
        <label>Shift type<Select value={draft.dayOff ? 'off' : 'work'} onChange={event => update('dayOff', event.target.value === 'off')}><option value="work">Working shift</option><option value="off">Day off</option></Select></label>
        <label>Availability<Select value={draft.active ? 'active' : 'inactive'} onChange={event => update('active', event.target.value === 'active')}><option value="active">Active</option><option value="inactive">Inactive · keep existing assignments</option></Select></label>
      </div>
      {!draft.dayOff && <><h3 className="font-semibold">Working hours</h3><div className="hr-profile-fields">
        {(['start', 'end'] as const).map((key, index) => <label key={key}>{['Check-in time', 'Check-out time'][index]}<Input type="text" placeholder="HH:MM" maxLength={5} required value={draft[key]} onChange={event => update(key, event.target.value)} /></label>)}
        <label>Check-out day<Select value={draft.nextDay ? 'next' : 'same'} onChange={event => update('nextDay', event.target.value === 'next')}><option value="same">Same day</option><option value="next">Next day · overnight shift</option></Select></label>
        <label>Break mode<Select value={draft.breakMode} onChange={event => update('breakMode', event.target.value)}><option value="none">No break</option><option value="fixed">Fixed break window</option><option value="flexible">Flexible break · duration only</option></Select></label>
        {draft.breakMode === 'fixed' && (['breakStart', 'breakEnd'] as const).map((key, index) => <label key={key}>{['Break starts', 'Break ends'][index]}<Input type="text" placeholder="HH:MM" maxLength={5} required value={draft[key]} onChange={event => update(key, event.target.value)} /></label>)}
        {draft.breakMode === 'flexible' && <label>Break duration · minutes<Input inputMode="numeric" required value={draft.breakMinutes} onChange={event => update('breakMinutes', event.target.value)} /></label>}
        {draft.breakMode !== 'none' && <label>Break compensation<Select value={draft.paidBreak ? 'paid' : 'unpaid'} onChange={event => update('paidBreak', event.target.value === 'paid')}><option value="unpaid">Unpaid break</option><option value="paid">Paid break</option></Select></label>}
      </div><h3 className="font-semibold">Attendance options · configuration preview</h3><div className="hr-profile-fields">
        {(['requireIn', 'requireOut', 'requireBreak'] as const).filter(key => key !== 'requireBreak' || draft.breakMode !== 'none').map((key, index) => <label key={key}>{['Clock-in required', 'Clock-out required', 'Break punches required'][index]}
          <Select value={draft[key] ? 'yes' : 'no'} onChange={event => update(key, event.target.value === 'yes')}><option value="yes">Yes</option><option value="no">No</option></Select></label>)}
        {(['lateTolerance', 'breakTolerance'] as const).map((key, index) => <label key={key}>{['Late tolerance · minutes', 'Break overrun tolerance · minutes'][index]}<Input value={draft[key]} inputMode="numeric" placeholder="Inherit payroll parameters" onChange={event => update(key, event.target.value)} /></label>)}
      </div><p className="hr-muted">These options are saved for review. Audit, deductions and paid-break calculations are not connected yet. Overtime remains subject to approval.</p></>}
      <label className="hr-form">Change reason<Input value={reason} required maxLength={500} onChange={event => setReason(event.target.value)} /></label>
      <div className="hr-tabs"><Button variant="ink">Save shift</Button><Button type="button" variant="secondary" onClick={() => setDraft(null)}>Cancel</Button></div>
    </form>}
  </div>;
}
