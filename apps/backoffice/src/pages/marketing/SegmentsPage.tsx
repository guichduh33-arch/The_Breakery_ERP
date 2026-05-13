// apps/backoffice/src/pages/marketing/SegmentsPage.tsx
//
// Session 13 / Phase 6.B — RFM customer segments report.

import { ReportPage } from '@/features/reports/components/ReportPage.js';
import { SegmentList } from '@/features/marketing/components/SegmentList.js';
import { useCustomerSegments } from '@/features/marketing/hooks/useCustomerSegments.js';

export default function SegmentsPage() {
  const { data, isLoading, error } = useCustomerSegments('all');

  return (
    <ReportPage
      title="Customer Segments"
      subtitle="RFM-style segmentation (recency / frequency / monetary). Counts as of right now."
    >
      {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error.message ?? 'Failed to load segments.'}
        </p>
      )}
      {data !== undefined && data !== null && <SegmentList segments={data} />}
    </ReportPage>
  );
}
