// apps/backoffice/src/pages/marketing/BirthdayPage.tsx
//
// Session 13 / Phase 6.B — Upcoming birthdays + recent notifications log.

import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { BirthdayList } from '@/features/marketing/components/BirthdayList.js';
import {
  useUpcomingBirthdays,
  useBirthdayNotificationLog,
} from '@/features/marketing/hooks/useBirthdayCustomers.js';

export default function BirthdayPage() {
  const { data: upcoming, isLoading: upLoading, error: upError } = useUpcomingBirthdays(30);
  const { data: log,      isLoading: logLoading, error: logError } = useBirthdayNotificationLog(50);

  return (
    <ReportPage
      title="Birthdays"
      subtitle="Upcoming customer birthdays + recent notification activity. Cron `birthday-notify-daily` fires at 09:00 UTC daily."
    >
      {(upLoading || logLoading) && (
        <p className="text-sm text-text-secondary">Loading…</p>
      )}
      {(upError ?? logError) && (
        <p className="text-sm text-danger" role="alert">
          {(upError ?? logError)?.message ?? 'Failed to load birthday data.'}
        </p>
      )}
      {upcoming !== undefined && log !== undefined && (
        <BirthdayList upcoming={upcoming ?? []} log={log ?? []} />
      )}
    </ReportPage>
  );
}
