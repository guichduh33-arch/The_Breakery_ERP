import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { todayIsoDate } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { getStations, kitchenError } from './api.js';
import { KitchenEntry } from './KitchenEntry.js';
import { KitchenHistory } from './KitchenHistory.js';
import { kitchenButton, kitchenControl, FOCUS_RING } from './controls.js';

export default function KitchenPage() {
  const user = useAuthStore(s => s.user);
  const authenticated = useAuthStore(s => s.isAuthenticated);
  const allowed = useAuthStore(s => s.hasPermission)('inventory.production.kitchen');
  const logout = useAuthStore(s => s.logout);
  const qc = useQueryClient();
  const [online, setOnline] = useState(navigator.onLine);
  const [today, setToday] = useState(todayIsoDate);
  const [selected, setSelected] = useState('');
  const [switching, setSwitching] = useState(false);
  const stations = useQuery({ queryKey: ['kitchen', user?.id, 'stations'], queryFn: getStations,
    enabled: authenticated && allowed && online, retry: false });
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); setToday(todayIsoDate()); };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const timer = window.setInterval(update, 30_000);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.clearInterval(timer); };
  }, []);
  // Aucune donnée du précédent chef n'est réutilisée après une expiration de session.
  useEffect(() => () => { qc.removeQueries({ queryKey: ['kitchen'] }); }, [qc, user?.id]);
  if (!authenticated || !user) return <Navigate to="/login?next=kitchen" replace />;
  const station = stations.data?.find(s => s.id === selected) ?? stations.data?.[0];

  async function switchUser() {
    setSwitching(true);
    await qc.cancelQueries();
    qc.clear();
    try { await logout(); } finally { setSwitching(false); }
  }

  return <div className="h-dvh overflow-y-auto scroll-pt-44 bg-bg-base text-text-primary" data-testid="kitchen-scroll">
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg-elevated px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Kitchen</h1><p className="text-text-secondary">{user.full_name}</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <span role="status" className={online ? 'text-success' : 'text-warning'}>{online ? 'Online' : 'Offline'}</span>
          <button className={kitchenButton} type="button" disabled={switching} onClick={() => void switchUser()}>
            {switching ? 'Signing out…' : 'Switch user'}
          </button>
        </div>
        {station && <label className="flex w-full items-center gap-3"><span className="font-medium">Station</span>
          <select className={`${kitchenControl} flex-1 ${FOCUS_RING}`} value={station.id} onChange={e => setSelected(e.target.value)}>
            {stations.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>}
      </div>
    </header>
    <main id="main-content" className="mx-auto max-w-5xl space-y-8 px-4 py-6 sm:px-6">
      {!allowed ? <section className="space-y-3"><h2 className="text-xl font-semibold">Kitchen access required</h2>
        <p>Ask a super admin to enable kitchen access and assign your production stations.</p>
        <Link className={`${kitchenButton} inline-flex items-center`} to="/backoffice">Back to backoffice</Link>
      </section> : <>
        {stations.isLoading && <p role="status">Loading your stations…</p>}
        {stations.isError && <div role="alert" className="space-y-3"><p>{kitchenError(stations.error)}</p>
          <button className={kitchenButton} type="button" disabled={!online || stations.isFetching} onClick={() => void stations.refetch()}>Retry</button>
        </div>}
        {stations.data?.length === 0 && <p>No production station is assigned to you. Ask a super admin to assign one.</p>}
        {station && <>
          <KitchenEntry key={`${user.id}:${station.id}`} userId={user.id} sectionId={station.id} online={online} today={today} />
          <KitchenHistory key={`history:${user.id}:${station.id}`} userId={user.id} sectionId={station.id} online={online} today={today} />
        </>}
      </>}
    </main>
  </div>;
}
