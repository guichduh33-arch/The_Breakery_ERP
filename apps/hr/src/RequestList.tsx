import { RequestAttachment } from './features/RequestAttachment';
import { StatusTag } from './features/PageElements';
import { Button, Input } from '@breakery/ui';
import { kindLabels, decideRequest } from './model';
import type { Request, Employee } from './model';
interface Props {
  requests: Request[];
  team: Employee[];
  own: boolean;
  setRequests: (requests: Request[]) => void;
  run: (action: () => void) => void;
}
const field = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
};
export function RequestList({ requests, team, own, setRequests, run }: Props) {
  const status = (s: string) =>
    own
      ? ({
          pending: 'Menunggu',
          approved: 'Disetujui',
          rejected: 'Ditolak',
          cancelled: 'Dibatalkan',
        }[s] ?? s)
      : s;
  return (
    <div className="hr-stack">
      {requests
        .filter((r) => !own || r.employee === '001')
        .map((r) => (
          <article className="hr-card" key={r.id}>
            <div className="flex justify-between gap-3">
              <strong>{kindLabels[r.kind][own ? 1 : 0]}</strong>
              <StatusTag tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'neutral'}>{status(r.status)}</StatusTag>
            </div>
            <p>
              {team.find((e) => e.id === r.employee)?.name} · {r.date}
            </p>
            <p>{r.reason}</p>
            {r.attachment && <RequestAttachment file={r.attachment} staff={own} />}
            {r.details && <p>{r.details}</p>}
            {r.decision && (
              <p>
                {own ? 'Alasan keputusan' : 'Decision reason'}: {r.decision}
              </p>
            )}
            {!own && r.status === 'pending' && (
              <form
                className="hr-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  run(() =>
                    setRequests(decideRequest(requests, r.id, 'approved', field(data, 'decision'))),
                  );
                }}
              >
                <label>
                  Decision reason
                  <Input name="decision" required />
                </label>
                <div className="flex gap-3">
                  <Button variant="ink" type="submit">
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={(event) => {
                      const form = event.currentTarget.closest('form')!;
                      run(() =>
                        setRequests(
                          decideRequest(
                            requests,
                            r.id,
                            'rejected',
                            field(new FormData(form), 'decision'),
                          ),
                        ),
                      );
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </form>
            )}
          </article>
        ))}
    </div>
  );
}
