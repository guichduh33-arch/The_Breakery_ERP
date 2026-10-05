import { componentTemplates, componentAmount, saveComponent } from './payrollComponents';
import { PageIntro, SummaryStrip, StatusTag } from './PageElements';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Button, Input, Select } from '@breakery/ui';
import { money } from '../model';
import { salaryPreview } from './demoRules';
import type { Adjustment, Preview } from './demoRules';
import type { Employee } from '../model';
export interface PayrollState {
  employee: string;
  lines: Adjustment[];
  snapshot: Preview | null;
  version: number;
}
export const initialPayroll: PayrollState = {
  employee: '001',
  lines: [],
  snapshot: null,
  version: 1,
};
export function PayrollPanel({
  team,
  state,
  setState,
  staff,
}: {
  team: Employee[];
  state: PayrollState;
  setState: (s: PayrollState) => void;
  staff: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [basis, setBasis] = useState('fixed'); const [quantity, setQuantity] = useState('1');
  const [feedback, setFeedback] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [type, setType] = useState<'allowance' | 'deduction'>('allowance');
  const [error, setError] = useState('');
  const employee = team.find((e) => e.id === state.employee) ?? team[0]!;
  let preview: Preview | null = null;
  try {
    preview = state.snapshot ?? salaryPreview(employee.salary, state.lines);
  } catch {
    preview = null;
  }
  if (staff)
    return (
      <div className="hr-stack">
        <div className="hr-card">
          <h2 className="text-xl font-semibold">Slip gaji dan THR</h2>
          <p>Oktober 2026 · Data contoh</p>
          {state.employee === '001' && state.snapshot ? (
            <Payslip preview={state.snapshot} name={employee.name} />
          ) : (
            <p>Belum ada slip gaji contoh yang diterbitkan untuk Anda.</p>
          )}
        </div>
        <div className="hr-card">
          <h2>THR</h2>
          <p>Belum ada slip THR. Ketentuan dan kampanye belum ditetapkan.</p>
        </div>
        <p>Slip ini hanya contoh, bukan dokumen pembayaran resmi.</p>
      </div>
    );
  return (
    <div className="hr-stack hr-payroll">
      <PageIntro title="Monthly payroll preview" action={<Link to="/admin/monthly-audit">Review attendance →</Link>}>Build adjustable pay components using fixed amounts or quantity × rate. Totals update automatically; review the Indonesian slip before freezing a demo snapshot.</PageIntro>
      <SummaryStrip items={[{ label: 'Gross preview', value: preview ? money(preview.gross) : 'Unavailable', tone: 'success' }, { label: 'Deductions', value: preview ? money(preview.deductions) : 'Unavailable', tone: 'warning' }, { label: 'Net preview', value: preview ? money(preview.net) : 'Unavailable' }]} />
      <div className="hr-run-steps"><StatusTag tone="success">Draft inputs</StatusTag><StatusTag tone={state.snapshot ? 'success' : 'warning'}>{state.snapshot ? 'Frozen demo preview' : 'Review preview'}</StatusTag><StatusTag>Real validation · pending backend</StatusTag><StatusTag>Payment · not connected</StatusTag></div>
      <div className="hr-toolbar">
        <label>
          Employee
          <Select
            value={state.employee}
            disabled={Boolean(state.snapshot)}
            onChange={(e) => { setState({ ...state, employee: e.target.value, lines: [] }); setEditing(null); setLabel(''); setAmount(''); setReason(''); setError(''); setFeedback(''); }}
          >
            {team.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </label>
        <span className="hr-data">OCT 2026 · DEMO VERSION {state.version}</span>
        <StatusTag tone={state.snapshot ? 'success' : 'warning'}>{state.snapshot ? 'Frozen demo snapshot' : 'Draft preview'}</StatusTag>
      </div>
      <p>
        Illustrative basic salary + adjustments only. BPJS, attendance, service charge, overtime,
        tax, deduction caps and carry-over are not calculated in this preview.
      </p>
      <div className="hr-columns">
        <div className="hr-card hr-stack">
          <h2 className="text-xl font-semibold">Pay components</h2><p className="hr-muted">Basic salary comes from the employee profile. Add a component below; every saved change recalculates gross, deductions and take-home pay.</p>
          {!state.snapshot && <label>Component template<Select defaultValue="" onChange={event => { const template = componentTemplates.find(item => item.label === event.target.value); if (template) { setLabel(template.label); setType(template.type); setBasis(template.basis); setEditing(null); setAmount(''); setQuantity('1'); setReason(''); } }}><option value="">Choose a template</option>{componentTemplates.map(item => <option key={item.label}>{item.label}</option>)}</Select></label>}
          {state.lines.length === 0 && <p>No adjustments yet.</p>}
          {state.lines.map((l) => (
            <div className="hr-toolbar" key={l.id}>
              <div>
                <strong>{l.label}</strong>
                <p>{l.reason}</p>
                <p className="hr-data">
                  {l.type === 'deduction' ? '−' : '+'}
                  {money(l.amount)}
                </p>
              </div>
              {!state.snapshot && (
                <div className="hr-tabs"><Button variant="secondary" onClick={() => { setEditing(l.id); setLabel(l.label); setAmount(l.amount); setType(l.type); setReason(''); setBasis('fixed'); setError(''); }}>Edit {l.label}</Button><Button
                  variant="secondary"
                  onClick={() =>
                    setState({ ...state, lines: state.lines.filter((row) => row.id !== l.id) })
                  }
                >
                  Remove {l.label}
                </Button></div>
              )}
            </div>
          ))}
          {!state.snapshot && (
            <form
              className="hr-form"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const lines = saveComponent(state.lines, { id: editing ?? Math.max(0, ...state.lines.map(l => l.id)) + 1, label, amount: componentAmount(amount, quantity, basis), reason: reason.trim() + (basis === 'quantity' ? ' · ' + quantity + ' × Rp ' + amount : ''), type }, editing);
                  salaryPreview(employee.salary, lines);
                  setState({ ...state, lines });
                  setEditing(null); setFeedback('Component saved. Payroll totals recalculated.');
                  setLabel('');
                  setAmount('');
                  setReason('');
                  setError('');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Invalid adjustment');
                }
              }}
            >
              <label>
                Component type
                <Select
                  value={type}
                  onChange={(e) => setType(e.target.value as 'allowance' | 'deduction')}
                >
                  <option value="allowance">Allowance</option>
                  <option value="deduction">Deduction</option>
                </Select>
              </label>
              <label>
                Label on payslip · Indonesian
                <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
              </label>
              <label>Calculation basis<Select value={basis} onChange={event => setBasis(event.target.value)}><option value="fixed">Fixed amount</option><option value="quantity">Quantity × rate</option></Select></label>{basis === 'quantity' && <label>Quantity · days, hours or units<Input value={quantity} onChange={event => setQuantity(event.target.value)} inputMode="decimal" required /><span className="hr-muted">Enter reviewed quantities manually. Attendance and approved requests are not imported automatically.</span></label>}<label>
                {basis === 'quantity' ? 'Unit rate · whole IDR' : 'Amount · whole IDR'}
                <Input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  pattern="[0-9]+"
                  required
                />
              </label>
              <label>
                Adjustment reason
                <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
              </label>
              <div className="hr-tabs"><Button variant="ink">{editing === null ? 'Add component & recalculate' : 'Save component & recalculate'}</Button>{editing !== null && <Button type="button" variant="secondary" onClick={() => { setEditing(null); setLabel(''); setAmount(''); setReason(''); }}>Cancel edit</Button>}</div>
            </form>
          )}
          {error && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
        </div>
        <div className="hr-card hr-stack">
          <h2 className="text-xl font-semibold">Payroll review</h2><dl className="hr-definition-rows"><div><dt>Employee</dt><dd>{employee.name} · {employee.id}</dd></div><div><dt>Basic salary</dt><dd className="hr-data">{money(employee.salary)}</dd></div><div><dt>Components</dt><dd>{state.lines.filter(line => line.type === 'allowance').length} allowances · {state.lines.filter(line => line.type === 'deduction').length} deductions</dd></div></dl>{preview && BigInt(preview.net) < 0n && <p role="alert">Deductions exceed gross pay. Review components before freezing.</p>}<h3 className="text-xl font-semibold">Slip gaji preview</h3>
          {preview && <Payslip preview={preview} name={employee.name} />}
          <Button
            variant="ink"
            disabled={!state.snapshot && (!preview || BigInt(preview.net) < 0n || editing !== null)}
            onClick={() => {
              if (state.snapshot)
                setState({
                  ...state,
                  snapshot: null,
                  lines: state.snapshot.lines.map((l) => ({ ...l })),
                  version: state.version + 1,
                });
              else if (preview)
                setState({ ...state, snapshot: salaryPreview(employee.salary, state.lines) });
            }}
          >
            {state.snapshot ? 'Create new demo version' : 'Freeze & publish demo preview'}
          </Button>
          <p>
            Freeze copies the current input and result in memory. It does not validate or pay real
            wages.
          </p>
        </div>
      </div>
    </div>
  );
}
function Payslip({ preview, name }: { preview: Preview; name: string }) {
  return (
    <div lang="id" className="hr-stack">
      <p>
        <strong>{name}</strong>
        <br />
        SLIP GAJI CONTOH · Oktober 2026
      </p>
      <div>
        <h3 className="hr-section-title">PENDAPATAN</h3>
        <div className="hr-toolbar">
          <span>Gaji pokok</span>
          <span className="hr-data">{money(preview.base)}</span>
        </div>
        {preview.lines
          .filter((l) => l.type === 'allowance')
          .map((l) => (
            <div className="hr-toolbar" key={l.id}>
              <span>{l.label}</span>
              <span className="hr-data">{money(l.amount)}</span>
            </div>
          ))}
      </div>
      <div>
        <h3 className="hr-section-title">POTONGAN</h3>
        {preview.lines
          .filter((l) => l.type === 'deduction')
          .map((l) => (
            <div className="hr-toolbar" key={l.id}>
              <span>{l.label}</span>
              <span className="hr-data">{money(l.amount)}</span>
            </div>
          ))}
        <p>Total potongan: {money(preview.deductions)}</p>
      </div>
      <div>
        <h3 className="hr-section-title">TAKE HOME PAY · CONTOH</h3>
        <p className="hr-data text-2xl">{money(preview.net)}</p>
      </div>
    </div>
  );
}
export function ThrPanel() {
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="hr-form hr-card"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(true);
      }}
    >
      <h2 className="text-xl font-semibold">THR campaign draft</h2>
      <p>Define a campaign for review. No entitlement or amount is calculated yet.</p>
      <label>
        Campaign name
        <Input name="campaign" placeholder="THR 2027" required />
      </label>
      <label>
        Religious holiday date
        <Input type="date" required />
      </label>
      <label>
        Planned payment date
        <Input type="date" required />
      </label>
      <label>
        Reference components
        <Select>
          <option>Basic salary · proposed</option>
          <option>Basic salary + fixed allowances · proposed</option>
        </Select>
      </label>
      <label>
        Eligibility & prorating notes
        <Input placeholder="Rules awaiting approval" required />
      </label>
      <p>Tenure basis, rounding, resignation eligibility and multipliers remain unconfigured.</p>
      <Button variant="ink">Save demo campaign draft</Button>
      {saved && (
        <p role="status">Campaign draft kept in this screen. No payment or THR run created.</p>
      )}
    </form>
  );
}
