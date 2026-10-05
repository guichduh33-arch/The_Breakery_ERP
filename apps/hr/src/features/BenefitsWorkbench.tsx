import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Select } from '@breakery/ui';
import type { Employee } from '../model';
import { PageIntro, StatusTag, SummaryStrip } from './PageElements';
import { readField, validateThr } from './companyDemo';
import type { CompanyDemo } from './companyDemo';
export function ThrWorkbench({ team, state, setState }: { team: Employee[]; state: CompanyDemo; setState: (value: CompanyDemo) => void }) {
  const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  return <div className="hr-stack"><PageIntro title="THR campaign preparation">Plan the campaign dates and review the employee reference data. Eligibility and THR amounts are not inferred from this demo.</PageIntro>
    <SummaryStrip items={[{ label: 'Campaign', value: state.thr?.name ?? 'Not configured' }, { label: 'Employees to review', value: team.length }, { label: 'Calculated entitlement', value: 'Awaiting rules' }]} />
    <div className="hr-columns"><form className="hr-card hr-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); try {
      const campaign = validateThr({ name: readField(data, 'name'), holiday: readField(data, 'holiday'), payment: readField(data, 'payment'), components: readField(data, 'components'), notes: readField(data, 'notes') });
      setState({ ...state, thr: campaign }); setError(''); setSaved(true);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Invalid campaign.'); } }}><h3 className="text-xl font-semibold">Campaign draft</h3>
      <label>Campaign name<Input name="name" defaultValue={state.thr?.name ?? ''} placeholder="THR 2027" required /></label><label>Holiday date<Input name="holiday" defaultValue={state.thr?.holiday ?? ''} placeholder="YYYY-MM-DD" required maxLength={10} /></label><label>Proposed payment date<Input name="payment" defaultValue={state.thr?.payment ?? ''} placeholder="YYYY-MM-DD" required maxLength={10} /></label><label>Reference components<Select name="components" defaultValue={state.thr?.components ?? 'Basic salary'}><option>Basic salary</option><option>Basic salary + fixed allowances</option></Select></label><label>Eligibility & prorating notes<Input name="notes" defaultValue={state.thr?.notes ?? ''} required placeholder="Policy for review" maxLength={500} /></label>{error && <p role="alert">{error}</p>}<Button variant="ink">Save campaign draft</Button>{saved && <p role="status">Draft saved in this session. No THR run or payment created.</p>}</form>
      <section className="hr-card"><h3 className="text-xl font-semibold">Campaign checklist</h3><ol className="hr-checklist"><li>Confirm the holiday and approved payment deadline.</li><li>Review hire dates, contract status and eligible components.</li><li>Approve tenure, prorating, rounding and resignation rules.</li><li>Calculate and review adjustments before validation.</li><li>Publish individual Indonesian THR slips and record payment.</li></ol><Link to="/admin/settings">THR policy draft →</Link></section></div>
    <div className="hr-card hr-scroll"><table className="hr-table"><thead><tr><th>Employee</th><th>Hire date</th><th>Contract / status</th><th>Eligibility</th><th>THR amount</th></tr></thead><tbody>{team.map(employee => <tr key={employee.id}><th>{employee.name}</th><td>{employee.details?.hireDate ?? 'Not provided'}</td><td>{employee.details?.contractType ?? 'Not provided'} / {employee.details?.employmentStatus ?? 'Not provided'}</td><td><StatusTag tone="warning">To review</StatusTag></td><td>Not calculated</td></tr>)}</tbody></table></div>
  </div>;
}
const settingGroups: Record<string, [string, string, string][]> = {
  Company: [['company', 'Company name', 'The Breakery'], ['city', 'City', 'Lombok'], ['signer', 'Document signer', 'Demo HR manager']],
  Attendance: [['late', 'Late tolerance · minutes', '0'], ['break', 'Break tolerance · minutes', '15'], ['latePenalty', 'Flat lateness deduction · IDR', '25000'], ['breakPenalty', 'Flat break deduction · IDR', '25000']],
  Leave: [['accrual', 'Accrual cycle', 'Awaiting policy approval'], ['carry', 'Carry-over and expiry', 'Awaiting policy approval'], ['medical', 'Medical documents', 'Private storage pending']],
  Payroll: [['divisor', 'Day divisor', '26'], ['hours', 'Hours per day', '7'], ['meal', 'Meal allowance · IDR', '15000'], ['cap', 'Deduction cap ratio', '0.5'], ['cutoff', 'Payroll cut-off', 'Not configured']],
  'Service charge': [['mode', 'Mode · pool or point', 'pool'], ['pool', 'Monthly pool · IDR', '0'], ['point', 'Point value · IDR', '38500']],
  'BPJS & tax': [['invoice', 'Kesehatan invoice · IDR', 'Not provided'], ['bpjs', 'Membership and base', 'Per employee'], ['tax', 'PPh 21', 'Calculation hook pending']],
  Overtime: [['first', 'First-hour multiplier', '1.5'], ['next', 'Next-hour multiplier', '1.5'], ['auto', 'Auto-pay late check-out', 'false']],
  THR: [['tenure', 'Tenure basis and prorating', 'Awaiting policy approval'], ['round', 'Rounding', 'Awaiting policy approval'], ['resign', 'Resignation eligibility', 'Awaiting policy approval']],
  'Access & approvals': [['approval', 'Request reviewer', 'Admin / HR'], ['documents', 'Document visibility', 'Owner and HR only · backend pending'], ['clock', 'Identification and offline rules', 'Awaiting approval']],
};
export function SettingsWorkbench({ state, setState }: { state: CompanyDemo; setState: (value: CompanyDemo) => void }) {
  const [group, setGroup] = useState('Company'); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const latest = [...state.settings].reverse().find(item => item.group === group);
  return <div className="hr-stack"><PageIntro title="Policy & payroll parameter drafts">Version draft values by effective month and retain a change reason. These records do not modify formulas or enforce legal policies.</PageIntro>
    <div className="hr-notice">Deployment timezone: Asia/Makassar · WITA. Database versioning and access enforcement remain pending.</div>
    <div className="hr-settings-layout"><nav className="hr-settings-nav" aria-label="Settings categories">{Object.keys(settingGroups).map(item => <Button key={item} variant={item === group ? 'ink' : 'secondary'} onClick={() => { setGroup(item); setSaved(false); setError(''); }}>{item}</Button>)}</nav>
      <form key={group + (latest?.id ?? 0)} className="hr-card hr-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const period = readField(data, 'period'); const reason = readField(data, 'reason');
        if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period) || !reason) { setError('Use an effective month in YYYY-MM format and explain the change.'); return; }
        setState({ ...state, settings: [...state.settings, { id: state.settings.length + 1, group, period, reason, values: Object.fromEntries(settingGroups[group]!.map(([key]) => [key, readField(data, key)])) }] }); setError(''); setSaved(true);
      }}><h3 className="text-xl font-semibold">{group}</h3><label>Effective month<Input name="period" defaultValue={latest?.period ?? '2026-10'} placeholder="YYYY-MM" required maxLength={7} /></label>
        {settingGroups[group]!.map(([key, label, value]) => <label key={key}>{label}<Input name={key} defaultValue={latest?.values[key] ?? value} required maxLength={500} /></label>)}
        <label>Change reason<Input name="reason" required maxLength={500} /></label>{error && <p role="alert">{error}</p>}<Button variant="ink">Save new demo version</Button>{saved && <p role="status">Draft version saved in this session.</p>}</form></div>
    <section className="hr-card hr-scroll"><h3 className="text-xl font-semibold">Draft version history</h3><table className="hr-table"><thead><tr><th>Version</th><th>Group</th><th>Effective month</th><th>Reason</th><th>State</th></tr></thead><tbody>{[...state.settings].reverse().map(item => <tr key={item.id}><td className="hr-data">{item.id}</td><td>{item.group}</td><td>{item.period}</td><td>{item.reason}</td><td><StatusTag tone="warning">Draft · not applied</StatusTag></td></tr>)}</tbody></table>{!state.settings.length && <p>No saved versions. Choose a category, review the example values and save a draft with a reason.</p>}</section>
  </div>;
}
