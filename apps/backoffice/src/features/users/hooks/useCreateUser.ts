// apps/backoffice/src/features/users/hooks/useCreateUser.ts
// Session 13 / Phase 5.D — Wraps create_user_v1 RPC.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { USERS_LIST_KEY } from './useUsersList.js';

export interface CreateUserArgs {
  employee_code: string;
  full_name:     string;
  role_code:     string;
  pin:           string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation<string, Error, CreateUserArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('create_user_v1', {
        p_employee_code: args.employee_code,
        p_full_name:     args.full_name,
        p_role_code:     args.role_code,
        p_pin:           args.pin,
      });
      if (error !== null) throw new Error(error.message);
      return data as unknown as string;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: USERS_LIST_KEY });
    },
  });
}
