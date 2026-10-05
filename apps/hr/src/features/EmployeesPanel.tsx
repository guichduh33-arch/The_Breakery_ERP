import { useState } from 'react';
import { Button, Input } from '@breakery/ui';
import { money } from '../model';
import type { Employee } from '../model';
import { EmployeeDetails } from './EmployeeDetails';
import type { PresenceRow } from './presence';
import type { Request } from '../model';
import { addEmployee } from './demoRules';
export function EmployeesPanel({
  team,
  setTeam,
  run,
  presence,
  requests,
}: {
  team: Employee[];
  presence: PresenceRow[];
  requests: Request[];
  setTeam: (team: Employee[]) => void;
  run: (fn: () => void) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(team[0]?.id ?? null);
  const filtered = team.filter((e) =>
    (e.id + ' ' + e.name + ' ' + e.position + ' ' + (e.details?.department ?? '')).toLowerCase().includes(query.toLowerCase()),
  );
  const employee = team.find((e) => e.id === selected);
  return (
    <div className="hr-stack">
      <label className="hr-form">
        Search name, ID, position or department
        <Input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="hr-scroll hr-card">
        <table className="hr-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Full name</th>
              <th>Position</th>
              <th>Department</th>
              <th>Status / contract</th>
              <th>Hire date</th>
              <th>Basic salary</th>
              <th>Profile</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="hr-data">{e.id}</td>
                <td>{e.name}</td>
                <td>{e.position}</td>
                <td>{e.details?.department ?? 'Not provided'}</td>
                <td>{e.details?.employmentStatus ?? 'Not provided'}<div className="hr-muted">{e.details?.contractType ?? 'Contract not provided'}</div></td>
                <td className="hr-data">{e.details?.hireDate ?? 'Not provided'}</td>
                <td className="hr-data">{money(e.salary)}</td>
                <td>
                  <Button variant="secondary" onClick={() => setSelected(e.id)}>
                    View {e.name}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p>No employee matches the search.</p>}
      </div>
      {employee && <EmployeeDetails key={employee.id} employee={employee} team={team} setTeam={setTeam} run={run} requests={requests} presence={presence.find(row => row.employee.id === employee.id)} />}
      <form
        className="hr-form hr-card"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          const field = (key: string) => {
            const value = data.get(key);
            return typeof value === 'string' ? value : '';
          };
          run(() => {
            setTeam(
              addEmployee(team, field('id'), field('name'), field('position'), field('salary')),
            );
            form.reset();
          });
        }}
      >
        <h2 className="text-xl font-semibold">Add sample employee</h2>
        {[
          ['id', 'Employee ID'],
          ['name', 'Full name'],
          ['position', 'Position'],
          ['salary', 'Basic salary · whole IDR'],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <Input name={key} defaultValue={key === 'salary' ? '0' : undefined} required />
          </label>
        ))}
        <Button variant="ink">Add employee</Button>
      </form>
    </div>
  );
}
