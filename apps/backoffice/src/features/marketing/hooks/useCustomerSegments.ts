// apps/backoffice/src/features/marketing/hooks/useCustomerSegments.ts
//
// Wraps `get_customer_segments_v1(p_segment_type)` RPC. Returns RFM-like
// segment buckets.
//
// Session 13 / Phase 6.B.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type SegmentCode = 'all' | 'champions' | 'loyal' | 'at_risk' | 'new' | 'dormant' | 'lost';

export interface SegmentBucket {
  segment:        Exclude<SegmentCode, 'all'>;
  customer_count: number;
  total_spent:    number;
  avg_orders:     number;
}

export const SEGMENTS_QUERY_KEY = ['marketing', 'segments'] as const;

export function useCustomerSegments(segmentType: SegmentCode = 'all') {
  return useQuery<SegmentBucket[]>({
    queryKey: [...SEGMENTS_QUERY_KEY, segmentType] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_customer_segments_v1', {
        p_segment_type: segmentType,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        segment:        r.segment as SegmentBucket['segment'],
        customer_count: Number(r.customer_count),
        total_spent:    Number(r.total_spent),
        avg_orders:     Number(r.avg_orders),
      }));
    },
  });
}
