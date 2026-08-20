// apps/backoffice/src/lib/queryClient.ts
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { mutationErrorText } from './mutationErrorText.js';

// FILET DE DERNIER RECOURS (2026-08-20). Sans ce cache, une mutation sans
// `onError` sur un écran qui ne rend pas `.error` échoue SANS UN MOT :
// `isPending` retombe, le contrôle se réarme, l'écran montre encore la valeur
// voulue. L'utilisateur croit avoir enregistré.
//
// PORTÉE VOLONTAIREMENT ÉTROITE — on ne toaste QUE si l'appelant n'a pas
// déclaré son propre `onError`. Sinon les ~45 mutations qui gèrent déjà leur
// échec afficheraient deux surfaces pour un seul événement. Le filet couvre
// exactement le trou, pas plus.
//
// SORTIE EXPLICITE : `meta: { errorHandled: true }` sur un `useMutation` dont
// l'écran rend `.error` inline et qui ne veut pas du toast en plus. C'est un
// opt-out nommé, pas un défaut silencieux.
const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    if (mutation.options.onError !== undefined) return;
    if (mutation.meta?.errorHandled === true) return;
    toast.error(mutationErrorText(error));
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});
