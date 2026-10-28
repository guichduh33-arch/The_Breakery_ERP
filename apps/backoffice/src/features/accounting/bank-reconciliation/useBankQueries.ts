import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore.js';
import { readBankCatalog, readBankClearing, readBankDetail, readBankList, readBankSuggestions } from './api.js';

export function useBankCatalog() {
  const profile = useAuthStore((s) => s.user?.id);
  const enabled = useAuthStore((s) => s.hasPermission('accounting.bank.read'));
  return useQuery({ queryKey: ['bank-reconciliation','catalog',profile], queryFn: readBankCatalog, enabled });
}
export function useBankList(account: string) {
  const profile = useAuthStore((s) => s.user?.id);
  const enabled = useAuthStore((s) => s.hasPermission('accounting.bank.read'));
  return useInfiniteQuery({ queryKey: ['bank-reconciliation','list',profile,account], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => readBankList(account,pageParam), getNextPageParam: (page) => page.next ?? undefined, enabled });
}
export function useBankDetail(reconciliationId: string) {
  const profile = useAuthStore((s) => s.user?.id);
  const allowed = useAuthStore((s) => s.hasPermission('accounting.bank.read'));
  return useInfiniteQuery({ queryKey: ['bank-reconciliation','detail',profile,reconciliationId],
    initialPageParam: { bank: 0, gl: null as string | null },
    queryFn: ({ pageParam }) => readBankDetail(reconciliationId,pageParam.bank,pageParam.gl),
    getNextPageParam: (page, _pages, previous) => {
      if (page.next_bank_after === null && page.next_gl_after === null) return undefined;
      return { bank: page.next_bank_after ?? page.bank_lines.at(-1)?.ordinal ?? previous.bank,
        gl: page.next_gl_after ?? page.gl_lines.at(-1)?.id ?? previous.gl };
    }, enabled: allowed && Boolean(reconciliationId) });
}
export function useBankClearing(reconciliationId: string, open: boolean) {
  const profile = useAuthStore((s) => s.user?.id);
  const allowed = useAuthStore((s) => s.hasPermission('accounting.bank.read'));
  return useInfiniteQuery({ queryKey: ['bank-reconciliation','clearing',profile,reconciliationId], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => readBankClearing(reconciliationId,pageParam), getNextPageParam: (page) => page.next ?? undefined,
    enabled: open && allowed && Boolean(reconciliationId) });
}
export function useBankSuggestions(reconciliationId: string, enabled: boolean) {
  const profile = useAuthStore((s) => s.user?.id);
  return useInfiniteQuery({ queryKey: ['bank-reconciliation','suggestions',profile,reconciliationId], initialPageParam: 0,
    queryFn: ({ pageParam }) => readBankSuggestions(reconciliationId,pageParam), getNextPageParam: (page) => page.next_after ?? undefined,
    enabled: enabled && Boolean(reconciliationId) });
}
