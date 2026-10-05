import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Select } from '@breakery/ui';
import type { Employee, Request } from '../model';
import { kindLabels } from '../model';
import type { PlanningState } from './Workforce';
import { monthDates, moveMonth, calendarEvents } from './operational';
import { PageIntro, StatusTag } from './PageElements';
export function CalendarPanel({ team, planning, requests, staff }: { team: Employee[]; planning: PlanningState; requests: Request[]; staff: boolean }) {
  const [month, setMonth] = useState('2026-10'); const [selected, setSelected] = useState('2026-10-05');
  const [employee, setEmployee] = useState('all'); const [kind, setKind] = useState('all');
  const people = staff ? team.filter(item => item.id === '001') : team;
  const events = calendarEvents(people, planning.published ?? planning.draft, planning.publishedCatalog ?? planning.catalog, requests.filter(item => !staff || item.employee === '001'))
    .filter(event => (employee === 'all' || event.employee === employee) && (kind === 'all' || event.kind === kind));
  const catalog = planning.publishedCatalog ?? planning.catalog;
  const eventTitle = (event: ReturnType<typeof calendarEvents>[number]) => event.kind === 'request' ? kindLabels[event.title as Request['kind']][staff ? 1 : 0] : staff ? catalog.find(item => item.label === event.title)?.staffLabel ?? event.title : event.title;
  const eventDetail = (detail: string) => staff ? ({ pending: 'Menunggu', approved: 'Disetujui' }[detail] ?? detail) : detail;
  const dates = monthDates(month); const daily = events.filter(event => event.date === selected);
  const locale = staff ? 'id-ID' : 'en-GB';
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'Asia/Makassar' }).format(new Date(month + '-01T00:00:00Z'));
  return <div className="hr-stack"><PageIntro title={staff ? 'Kalender saya' : 'Team calendar'} action={<Link to={staff ? '/staff/schedule' : '/admin/schedule'}>{staff ? 'Lihat jadwal' : 'Edit weekly schedule'} →</Link>}>
    {staff ? 'Pilih tanggal untuk melihat jadwal dan permintaan Anda.' : 'See published shifts, days off and requests together. Select a day to inspect the details.'}</PageIntro>
    <div className="hr-toolbar"><div className="hr-tabs"><Button variant="secondary" onClick={() => { const next = moveMonth(month, -1); setMonth(next); setSelected(next + '-01'); }}>{staff ? 'Sebelumnya' : 'Previous month'}</Button>
      <h3 className="text-xl font-semibold">{monthLabel}</h3><Button variant="secondary" onClick={() => { const next = moveMonth(month, 1); setMonth(next); setSelected(next + '-01'); }}>{staff ? 'Berikutnya' : 'Next month'}</Button></div>
      {!staff && <label>Employee<Select value={employee} onChange={event => setEmployee(event.target.value)}><option value="all">All employees</option>{people.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>}
      <label>{staff ? 'Tampilkan' : 'Show'}<Select value={kind} onChange={event => setKind(event.target.value)}><option value="all">{staff ? 'Semua' : 'All events'}</option><option value="schedule">{staff ? 'Jadwal' : 'Shifts & days off'}</option><option value="request">{staff ? 'Permintaan' : 'Requests'}</option></Select></label></div>
    <div className="hr-calendar-layout"><div className="hr-card hr-calendar-shell"><div className="hr-calendar-grid">
      {(staff ? ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map(day => <div className="hr-calendar-weekday" key={day}>{day}</div>)}
      {dates.map((date, index) => date ? <button key={date} className={'hr-calendar-day ' + (date === selected ? 'is-selected' : '')} aria-pressed={date === selected} aria-label={date + ' · ' + events.filter(event => event.date === date).length + (staff ? ' aktivitas' : ' events')} onClick={() => setSelected(date)}>
        <strong className="hr-data">{Number(date.slice(-2))}</strong><span className="hr-calendar-events">{events.filter(event => event.date === date).slice(0, 3).map((event, item) => <span key={item} className={'hr-calendar-event hr-tone-' + event.tone}>{eventTitle(event)}</span>)}
        {events.filter(event => event.date === date).length > 3 && <span>+{events.filter(event => event.date === date).length - 3}</span>}</span></button> : <div className="hr-calendar-blank" key={'blank-' + index} />)}
    </div></div><section className="hr-card hr-stack"><h3 className="text-xl font-semibold">{selected}</h3>
      <StatusTag tone={planning.published ? 'success' : 'warning'}>{staff ? planning.published ? 'Jadwal terbit' : 'Contoh draf' : planning.published ? 'Published schedule' : 'Draft schedule preview'}</StatusTag>
      {daily.length ? daily.map((event, index) => <div className="hr-agenda-row" key={index}><strong>{people.find(item => item.id === event.employee)?.name}</strong>
        <p>{eventTitle(event)}</p><StatusTag tone={event.tone}>{eventDetail(event.detail)}</StatusTag></div>) : <p className="hr-muted">{staff ? 'Tidak ada aktivitas contoh pada tanggal ini.' : 'No demo events on this date.'}</p>}
      <p className="hr-muted">{staff ? 'Data jadwal contoh tersedia 5–11 Oktober. Hari libur nasional belum dikonfigurasi.' : 'Demo shifts cover 5–11 October only. Public holidays are not configured; no calendar date is assumed to be a public holiday.'}</p></section></div>
  </div>;
}
