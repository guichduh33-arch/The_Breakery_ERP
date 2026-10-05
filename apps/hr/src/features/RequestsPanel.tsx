import { validateRequestAttachment } from './attachmentValidation';
import { PageIntro, SummaryStrip } from './PageElements';
import type { ShiftConfig } from './shiftRules';
import { useRef, useState } from 'react';
import { Button, Input, Select } from '@breakery/ui';
import { RequestList } from '../RequestList';
import { kindLabels } from '../model';
import type { Employee, Request, RequestKind } from '../model';
import { filterRequests, cancelRequest, detailedRequest } from './demoRules';
interface Props {
  requests: Request[];
  catalog: ShiftConfig[];
  team: Employee[];
  staff: boolean;
  setRequests: (r: Request[]) => void;
  run: (fn: () => void) => void;
}
export function RequestsPanel({ requests, team, staff, setRequests, run, catalog }: Props) {
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [filterKind, setFilterKind] = useState('all');
  const [kind, setKind] = useState<RequestKind>('leave');
  const [date, setDate] = useState('2026-10-08');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const filtered = filterRequests(requests, query, status, filterKind, staff ? '001' : undefined);
  const finance = kind === 'advance' || kind === 'reimbursement';
  return (
    <div className="hr-stack">
      <PageIntro title={staff ? 'Permintaan saya' : 'Request inbox'}>{staff ? 'Ajukan permintaan, pantau keputusan dan batalkan permintaan yang masih menunggu.' : 'Review staff submissions by type and status. Every approval or rejection requires a decision reason.'}</PageIntro>
      <SummaryStrip items={(['pending', 'approved', 'rejected', 'cancelled'] as const).map((value, index) => ({ label: staff ? ['Menunggu', 'Disetujui', 'Ditolak', 'Dibatalkan'][index]! : ['Pending', 'Approved', 'Rejected', 'Cancelled'][index]!, value: requests.filter(item => item.status === value && (!staff || item.employee === '001')).length, tone: value === 'approved' ? 'success' : value === 'pending' ? 'warning' : 'neutral' }))} />
      {staff && (
        <form
          className="hr-form hr-card"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => {
              if (attachmentError) throw new Error(attachmentError);
                  if (attachment) validateRequestAttachment(attachment);
                  const next = detailedRequest(requests, kind, date, reason, details, catalog);
                  const added = next[next.length - 1]!;
                  setRequests(next.map(item => item.id === added.id && attachment ? { ...item, attachment } : item));
                  setAttachment(null); if (fileInput.current) fileInput.current.value = '';
              setReason('');
              setDetails('');
            });
          }}
        >
          <h2 className="text-xl font-semibold">Ajukan permintaan</h2>
          <label>
            Jenis permintaan
            <Select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as RequestKind);
                setDetails('');
              }}
            >
              {Object.entries(kindLabels).map(([k, l]) => (
                <option key={k} value={k}>
                  {l[1]}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Tanggal
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {kind === 'shift' ? (
            <label>
              Shift yang diminta
              <Select required value={details} onChange={(e) => setDetails(e.target.value)}>
                <option value="">Pilih shift</option>
                {catalog.filter(s => s.active).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.hours}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <label>
              {finance
                ? 'Jumlah · Rupiah'
                : kind === 'overtime'
                  ? 'Jumlah jam lembur'
                  : 'Keterangan tambahan'}
              <Input
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                required={finance || kind === 'overtime'}
              />
            </label>
          )}
          <label>
            Alasan
            <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
          </label>
          <p>
            Permintaan satu hari dalam demo. Lampiran dan rentang tanggal akan tersedia setelah
            penyimpanan privat diaktifkan.
          </p>
          <label>Lampiran dokumen · opsional<Input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" aria-describedby="attachment-help" onChange={event => { const file = event.target.files?.[0]; setAttachment(null); setAttachmentError(''); if (!file) return; try { validateRequestAttachment(file); setAttachment(file); } catch (issue) { setAttachmentError(issue instanceof Error ? issue.message : 'Dokumen tidak valid.'); event.target.value = ''; } }} /></label><p id="attachment-help" className="hr-muted">PDF, JPG, PNG atau WebP · maksimal 5 MB. Gunakan dokumen fiktif untuk demo.</p>{attachment && <div className="hr-notice"><strong>{attachment.name}</strong><p>{Math.ceil(attachment.size / 1024)} KB</p><Button type="button" variant="secondary" onClick={() => { setAttachment(null); setAttachmentError(''); if (fileInput.current) fileInput.current.value = ''; }}>Hapus lampiran</Button></div>}{attachmentError && <p role="alert">{attachmentError}</p>}<Button disabled={Boolean(attachmentError)}>Kirim permintaan</Button>
        </form>
      )}
      <div className="hr-toolbar">
        <label>
          {staff ? 'Cari permintaan' : 'Search requests'}
          <Input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          {staff ? 'Status' : 'Request status'}
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {[
              ['all', staff ? 'Semua' : 'All statuses'],
              ['pending', staff ? 'Menunggu' : 'Pending'],
              ['approved', staff ? 'Disetujui' : 'Approved'],
              ['rejected', staff ? 'Ditolak' : 'Rejected'],
              ['cancelled', staff ? 'Dibatalkan' : 'Cancelled'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {staff ? 'Jenis' : 'Request type'}
          <Select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
            <option value="all">{staff ? 'Semua jenis' : 'All types'}</option>
            {Object.entries(kindLabels).map(([key, labels]) => (
              <option key={key} value={key}>
                {labels[staff ? 1 : 0]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {filtered.length === 0 ? (
        <div className="hr-card">
          {staff ? 'Tidak ada permintaan yang cocok.' : 'No requests match these filters.'}
        </div>
      ) : (
        <RequestList
          requests={filtered}
          team={team}
          own={staff}
          setRequests={(updated) => {
            const updates = new Map(updated.map((r) => [r.id, r]));
            setRequests(requests.map((r) => updates.get(r.id) ?? r));
          }}
          run={run}
        />
      )}
      {staff &&
        filtered
          .filter((r) => r.status === 'pending')
          .map((r) => (
            <Button
              key={r.id}
              variant="secondary"
              onClick={() => run(() => setRequests(cancelRequest(requests, r.id, '001')))}
            >
              Batalkan permintaan #{r.id}
            </Button>
          ))}
      {!staff && (
        <p>
          Admin / HR reviews all requests directly. Approved requests are not yet posted into
          payroll or real attendance.
        </p>
      )}
    </div>
  );
}
