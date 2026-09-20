import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAccess, saveAccess, kitchenError, type KitchenAccess } from './api.js';
import { kitchenButton, kitchenControl, FOCUS_RING } from './controls.js';

export function KitchenAccessPanel({ userId }: { userId: string }) {
  const access = useQuery({ queryKey: ['kitchen-access', userId], queryFn: () => getAccess(userId) });
  if (access.isLoading) return <p>Loading kitchen access…</p>;
  if (access.isError) return <div role="alert"><p>{kitchenError(access.error)}</p>
    <button className={kitchenButton} onClick={() => void access.refetch()} type="button">Retry kitchen access</button></div>;
  if (!access.data) return null;
  return <AccessForm key={`${userId}:${access.dataUpdatedAt}`} userId={userId} access={access.data} />;
}

function AccessForm({ userId, access }: { userId: string; access: KitchenAccess }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(access.enabled);
  const [ids, setIds] = useState(access.sections.filter(s => s.assigned).map(s => s.id));
  const [reason, setReason] = useState('');
  const mutation = useMutation({ mutationFn: () => saveAccess(userId, enabled, ids, reason.trim()),
    meta: { errorHandled: true },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['kitchen-access', userId] }); },
  });
  return <section className="space-y-4 rounded-sm border border-border-subtle p-4" aria-labelledby="kitchen-access-heading">
    <h2 id="kitchen-access-heading" className="text-lg font-semibold">Kitchen access</h2>
    <p className="text-sm text-text-secondary">Record today’s production on a shared tablet. Permission changes take effect at the next sign-in; station assignments are checked on every request.</p>
    <label className="flex min-h-12 items-center gap-3">
      <input type="checkbox" className={`h-5 w-5 ${FOCUS_RING}`} checked={enabled} disabled={mutation.isPending} onChange={e => setEnabled(e.target.checked)} />
      Enable kitchen access
    </label>
    <fieldset disabled={!enabled || mutation.isPending} className="space-y-2">
      <legend className="font-semibold">Assigned stations</legend>
      {access.sections.map(s => <label key={s.id} className="flex min-h-12 items-center gap-3">
        <input type="checkbox" className={`h-5 w-5 ${FOCUS_RING}`} checked={ids.includes(s.id)}
          onChange={e => setIds(current => e.target.checked ? [...current, s.id] : current.filter(id => id !== s.id))} />
        {s.name}
      </label>)}
    </fieldset>
    <label className="block space-y-1"><span>Reason for access change</span>
      <input className={`${kitchenControl} w-full placeholder:text-text-muted ${FOCUS_RING}`} value={reason} minLength={3} maxLength={200} disabled={mutation.isPending}
        onChange={e => setReason(e.target.value)} placeholder="Why is this access changing?" />
    </label>
    {mutation.isError && <p role="alert" className="text-danger">{kitchenError(mutation.error)}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" className={kitchenButton} disabled={mutation.isPending || reason.trim().length < 3 || (enabled && !ids.length)}
        onClick={() => mutation.mutate()}>{mutation.isPending ? 'Saving…' : 'Save kitchen access'}</button>
      <Link to="/kitchen" className={`${kitchenButton} inline-flex items-center`}>Open Kitchen</Link>
    </div>
  </section>;
}
