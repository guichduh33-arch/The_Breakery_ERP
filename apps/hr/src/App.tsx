import { StaffPreview } from './features/StaffPreview';
import './staffDesign.css';
import './adminDesign.css';
import { CalendarPanel } from './features/CalendarPanel';
import { AttendanceBoard } from './features/AttendanceBoard';
import { LeaveOverview, OvertimeOverview, AuditOverview } from './features/TimeInsights';
import { NoticeBoard, DocumentRegister, DisciplineJournal } from './features/CompanyWorkbench';
import { ThrWorkbench, SettingsWorkbench } from './features/BenefitsWorkbench';
import { StaffProfile } from './features/StaffProfile';
import { initialCompany } from './features/companyDemo';
import { sampleAttendance } from './features/operational';
import { demoPresence } from './features/presence';
import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { employees, initialRequests } from './model';
import { RequestsPanel } from './features/RequestsPanel';
import { EmployeesPanel } from './features/EmployeesPanel';
import { Planning, initialPlanning } from './features/Workforce';
import { PayrollPanel, initialPayroll } from './features/PayrollPanel';
import { Lifecycle } from './features/CompanyPanels';
import { Overview } from './features/Overview';
import { StaffClock } from './features/StaffClock';
import type { Punch } from './features/StaffClock';
const groups: Record<string, string[]> = {
  PEOPLE: ['Overview', 'Employees', 'Contracts & tasks'],
  TIME: ['Schedule', 'Calendar', 'Attendance', 'Leave', 'Overtime', 'Requests', 'Monthly audit'],
  'PAY & BENEFITS': ['Payroll', 'THR'],
  COMPANY: ['Announcements', 'Documents', 'Discipline', 'Settings'],
};
const slug = (s: string) => s.toLowerCase().replaceAll(' ', '-').replaceAll('&', 'and');
export function App() {
  return (
    <BrowserRouter>
      <Demo />
    </BrowserRouter>
  );
}
function Demo() {
  const [requests, setRequests] = useState(initialRequests);
  const [team, setTeam] = useState(employees);
  const [planning, setPlanning] = useState(initialPlanning);
  const [payroll, setPayroll] = useState(initialPayroll);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [offline, setOffline] = useState(false);
  const [ack, setAck] = useState<number[]>([]);
  const [company, setCompany] = useState(initialCompany);
  const [attendanceRecords, setAttendanceRecords] = useState(sampleAttendance);
  const [message, setMessage] = useState('');
  const location = useLocation();
  const staff = location.pathname.startsWith('/staff');
  useEffect(() => {
    setMessage('');
    window.scrollTo({ top: 0, left: 0 });
    document.documentElement.lang = staff ? 'id' : 'en';
  }, [location.pathname, staff]);
  const run = (fn: () => void) => {
    try {
      fn();
      setMessage(staff ? 'Berhasil disimpan dalam demo.' : 'Saved in this demo session.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : staff ? 'Data tidak valid.' : 'Invalid input',
      );
    }
  };
  const inbox = (own: boolean) => (
    <RequestsPanel
      requests={requests}
      catalog={planning.publishedCatalog ?? planning.catalog}
      team={team}
      staff={own}
      setRequests={setRequests}
      run={run}
    />
  );
  const schedule = (own: boolean) => (
    <Planning team={team} staff={own} state={planning} setState={setPlanning} />
  );
  const pay = (own: boolean) => (
    <PayrollPanel team={team} staff={own} state={payroll} setState={setPayroll} />
  );
  function adminPage(page: string) {
    switch (page) {
      case 'Overview':
        return <Overview team={team} requests={requests} published={Boolean(planning.published)} week={planning.published ?? planning.draft} punches={punches} catalog={planning.publishedCatalog ?? planning.catalog} />;
      case 'Employees':
        return <EmployeesPanel team={team} setTeam={setTeam} run={run} requests={requests} presence={demoPresence(team, planning.published ?? planning.draft, requests, punches, planning.publishedCatalog ?? planning.catalog)} />;
      case 'Contracts & tasks':
        return <Lifecycle />;
      case 'Schedule':
        return schedule(false);
      case 'Calendar':
        return <CalendarPanel team={team} planning={planning} requests={requests} staff={false} />;
      case 'Attendance':
        return <AttendanceBoard team={team} records={attendanceRecords} setRecords={setAttendanceRecords} />;
      case 'Leave':
        return <LeaveOverview team={team} requests={requests} staff={false} />;
      case 'Overtime':
        return <OvertimeOverview team={team} requests={requests} />;
      case 'Requests':
        return inbox(false);
      case 'Payroll':
        return pay(false);
      case 'THR':
        return <ThrWorkbench team={team} state={company} setState={setCompany} />;
      case 'Announcements':
        return <NoticeBoard state={company} setState={setCompany} staff={false} ack={ack} setAck={setAck} />;
      case 'Documents':
        return <DocumentRegister state={company} setState={setCompany} team={team} staff={false} />;
      case 'Settings':
        return <SettingsWorkbench state={company} setState={setCompany} />;
      case 'Monthly audit':
        return <AuditOverview team={team} records={attendanceRecords} />;
      case 'Discipline':
        return <DisciplineJournal team={team} state={company} setState={setCompany} />;
      default:
        return (
          <div className="hr-card">
            Page not found. <Link to="/admin/overview">Overview</Link>
          </div>
        );
    }
  }
  function staffPage(page: string) {
    switch (page) {
      case 'home':
      case 'preview':
        return <StaffPreview />;
      case 'clock-demo':
        return (
          <div className="hr-stack">
            <StaffClock
              employeeName={team.find(employee => employee.id === '001')?.name ?? 'Staf'}
              workingWindow={(planning.publishedCatalog ?? planning.catalog).find(shift => shift.code === (planning.published ?? planning.draft)['001']?.[0])?.hours ?? 'Belum ada jadwal'}
              punches={punches}
              setPunches={setPunches}
              offline={offline}
              setOffline={setOffline}
            />
            <div className="hr-card">
              <h2 className="text-xl font-semibold">Akses cepat</h2>
              <div className="hr-shortcuts">
                {[
                  ['leave', 'Saldo cuti'],
                  ['requests', 'Ajukan permintaan'],
                  ['announcements', 'Pengumuman'],
                  ['pay', 'Slip gaji & THR'],
                ].map(([p, l]) => (
                  <Link key={p} to={'/staff/' + p}>
                    {l} →
                  </Link>
                ))}
              </div>
            </div>
          </div>
        );
      case 'schedule':
        return schedule(true);
      case 'requests':
        return inbox(true);
      case 'leave':
        return <LeaveOverview team={team} requests={requests} staff />;
      case 'pay':
        return pay(true);
      case 'profile':
        return <StaffProfile employee={team.find(employee => employee.id === '001')} />;
      case 'documents':
        return <DocumentRegister state={company} setState={setCompany} team={team} staff />;
      case 'announcements':
        return <NoticeBoard state={company} setState={setCompany} staff ack={ack} setAck={setAck} />;
      case 'calendar':
        return <CalendarPanel team={team} planning={planning} requests={requests} staff />;
      default:
        return (
          <div className="hr-card">
            Halaman tidak ditemukan. <Link to="/staff/home">Beranda</Link>
          </div>
        );
    }
  }
  const adminTitle = Object.values(groups)
    .flat()
    .find((p) => location.pathname === '/admin/' + slug(p));
  return (
    <div
      className={
        (staff ? 'theme-pos' : 'theme-backoffice') + ' bg-bg-base text-text-primary min-h-screen'
      }
      lang={staff ? 'id' : 'en'}
    >
      <a className="hr-skip-link" href="#hr-content">{staff ? 'Lewati ke konten' : 'Skip to content'}</a>
      <div className="hr-banner">
        {staff
          ? 'DEMO · Data fiktif · Data dihapus saat halaman dimuat ulang'
          : 'DEMO · Fictional data · Changes reset on reload'}{' '}
        · <Link to="/">{staff ? 'Ganti ruang' : 'Switch workspace'}</Link>
      </div>
      {message && (
        <div role="status" className="hr-banner">
          {message}
        </div>
      )}
      <Routes>
        <Route
          path="/"
          element={
            <main className="hr-staff hr-stack" id="hr-content">
              <p className="hr-data">THE BREAKERY / PEOPLE</p>
              <h1 className="hr-title">Breakery HR</h1>
              <p>Independent HR demonstration. Choose a workspace to explore.</p>
              <Link className="hr-card" to="/admin/overview">
                <h2 className="text-xl font-semibold">HR Administration →</h2>
                <p>Employees, planning, requests and payroll preview.</p>
              </Link>
              <Link className="hr-card" to="/staff/home">
                <h2 className="text-xl font-semibold">Ruang staf →</h2>
                <p>Absensi, jadwal, permintaan dan slip gaji.</p>
              </Link>
              <p>No production connection or real sign-in.</p>
            </main>
          }
        />
        <Route
          path="/admin/*"
          element={
            <div className="hr-grid">
              <aside className="hr-nav">
                <p className="hr-data font-semibold">BREAKERY HR</p>
                <nav aria-label="HR administration">
                  {Object.entries(groups).map(([group, pages]) => (
                    <div key={group}>
                      <p className="hr-section-title">{group}</p>
                      {pages.map((p) => (
                        <NavLink key={p} to={'/admin/' + slug(p)}>
                          {p}
                        </NavLink>
                      ))}
                    </div>
                  ))}
                </nav>
              </aside>
              <main className="hr-main" id="hr-content">
                <h1 className="hr-title">{adminTitle ?? 'Page not found'}</h1>
                <p className="hr-subtitle">People operations · October 2026 · Demo workspace</p>
                {adminPage(adminTitle ?? '')}
              </main>
            </div>
          }
        />
        <Route
          path="/staff/*"
          element={
            <main className="hr-staff hr-stack" id="hr-content">
              <h1 className="hr-title">Ruang staf</h1>
              <nav aria-label="Navigasi staf">
                {[
                  ['preview', 'Pratinjau lengkap'],
                  ['home', 'Beranda'],
                  ['schedule', 'Jadwal'],
                  ['requests', 'Permintaan'],
                  ['leave', 'Cuti'],
                  ['pay', 'Slip gaji'],
                  ['profile', 'Profil'],
                  ['announcements', 'Pengumuman'],
                  ['documents', 'Dokumen'],
                  ['calendar', 'Kalender'],
                ].map(([p, l]) => (
                  <NavLink key={p} to={'/staff/' + p}>
                    {l}
                  </NavLink>
                ))}
              </nav>
              {staffPage(location.pathname.split('/')[2] ?? 'home')}
            </main>
          }
        />
        <Route
          path="*"
          element={
            <main className="hr-staff">
              <h1>Page not found</h1>
              <Link to="/">HR access</Link>
            </main>
          }
        />
      </Routes>
    </div>
  );
}
