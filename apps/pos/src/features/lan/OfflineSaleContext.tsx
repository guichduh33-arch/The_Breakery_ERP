import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore, type ActiveShift } from '@/stores/shiftStore';
import { supabaseUrl } from '@/lib/supabase';
import { localSessionValid, isSameTabReload } from '@/features/auth/localSession';
import { useProducts } from '@/features/products/hooks/useProducts';
import { useStationMap } from '@/features/cart/hooks/useStationMap';
import { useCategories } from '@/features/products/hooks/useCategories';
import { useProductModifiers } from '@/features/products/hooks/useProductModifiers';
import { usePromotionVariants } from '@/features/products/hooks/usePromotionVariants';
import { useComboConfig } from '@/features/combos/hooks/useComboConfig';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';
import { useOfflineNetworkConfig } from '@/features/settings/hooks/useOfflineNetworkConfig';
import { useEnabledPaymentMethods } from '@/features/settings/hooks/useEnabledPaymentMethods';
import { useCurrentShift } from '@/features/shift/hooks/useShift';
import { usePromotions } from '@/features/promotions/hooks/usePromotions';
import { useLanCredential } from './lanCredential';
import { clearSaleSnapshot, isSaleSnapshotQuery, restoreSaleSnapshot, saveSaleSnapshot, saleKeys, SALE_SNAPSHOT_KEY, type SaleIdentity } from './offlineSaleSnapshot';
import { useCloudStatusStore } from './cloudStatusStore';
import { TabletOptionsPreload } from './TabletOptionsPreload';

function Modifiers({ id, category }: { id: string; category: string | null }) {
  useProductModifiers({ productId: id, categoryId: category });
  return null;
}
function Combo({ id }: { id: string }) {
  // Inclut les modificateurs des composants dans la définition canonique.
  useComboConfig(id);
  return null;
}
function PreloadSale() {
  const { data = [] } = useProducts();
  const variants = usePromotionVariants(data.filter((product) => product.has_variants).map((product) => product.id));
  useStationMap();
  useCategories();
  useTaxConfig();
  useOfflineNetworkConfig();
  useEnabledPaymentMethods();
  useCurrentShift();
  usePromotions();
  return <>{data.map((product) => <div key={product.id} hidden>
    <Modifiers id={product.id} category={product.category_id} />
    {(variants.get(product.id) ?? []).map((variant) => <Modifiers key={variant.id} id={variant.id} category={product.category_id} />)}
    {product.product_type === 'combo' && <Combo id={product.id} />}
  </div>)}</>;
}

/** Persistance de données commerciales, sans nouvelle autorité d'authentification. */
export function OfflineSaleContext() {
  const client = useQueryClient();
  const auth = useAuthStore();
  const terminal = useLanCredential((state) => state.credential?.id);
  const cloudOnline = useCloudStatusStore((state) => state.cloudOnline);
  const { pathname } = useLocation();
  const initialRestore = useRef(false);
  const previousIdentity = useRef<string | null>(null);
  const dirty = useRef(true);
  const saved = useRef<{ client: QueryClient; signature: string | null; shift: ActiveShift; serialized: string | null } | null>(null);

  useLayoutEffect(() => {
    if (auth.bootstrapStatus !== 'ready') return;
    const identity: SaleIdentity | null = auth.isAuthenticated && auth.user && auth.sessionToken && terminal
      ? { project: supabaseUrl, terminal, user: auth.user.id, session: auth.sessionToken } : null;
    const signature = identity ? JSON.stringify(identity) : null;
    const valid = localSessionValid(auth.localSession, auth.sessionToken, auth.user?.id);
    let storage: Storage;
    try { storage = sessionStorage; } catch { return; }
    if (!identity || !valid) {
      clearSaleSnapshot(storage);
      previousIdentity.current = signature;
      return;
    }
    if (previousIdentity.current !== null && previousIdentity.current !== signature) clearSaleSnapshot(storage);
    previousIdentity.current = signature;
    if (!initialRestore.current) {
      initialRestore.current = true;
      if (!auth.isLocked && isSameTabReload()) {
        const shift = restoreSaleSnapshot(storage, client, identity);
        if (shift) useShiftStore.getState().setCurrent(shift);
        else clearSaleSnapshot(storage);
      } else clearSaleSnapshot(storage);
    }
    if (!cloudOnline && !auth.isLocked && (pathname === '/pos' || pathname === '/pos/')) {
      const activeShift = useShiftStore.getState().current;
      if (activeShift) restoreSaleSnapshot(storage, client, identity, { onlyMissing: true, expectedShiftId: activeShift.id });
    }
    const save = () => {
      const current = useAuthStore.getState();
      if (!useCloudStatusStore.getState().cloudOnline || !current.cloudValidated) {
        // Une requête déjà partie peut échouer après la coupure. Les données
        // connues restent utilisables, sans convertir une absence en succès.
        for (const key of saleKeys(client) ?? []) {
          const state = client.getQueryState(key);
          if (state?.status === 'error' && state.data !== undefined) {
            client.setQueryData(key, state.data, { updatedAt: state.dataUpdatedAt });
          }
        }
        return;
      }
      if (!current.isAuthenticated || current.bootstrapStatus !== 'ready' || current.isLocked || !current.cloudValidated
        || current.sessionToken !== identity.session || current.user?.id !== identity.user
        || useLanCredential.getState().credential?.id !== identity.terminal) return;
      if (!localSessionValid(current.localSession, current.sessionToken, current.user?.id)) return;
      const shift = useShiftStore.getState().current;
      const verifiedShift = client.getQueryState<{ id: string } | null>(['pos_sessions', 'current', identity.user]);
      if (verifiedShift?.status !== 'success' || !shift || verifiedShift.data?.id !== shift.id) return;
      // L'activité locale et les changements de route ne modifient pas le
      // catalogue : aucun parcours/JSON.stringify avant affichage dans ce cas.
      const previous = saved.current;
      try {
        if (!dirty.current && previous?.client === client && previous.signature === signature
          && previous.shift.id === shift.id && previous.shift.opened_at === shift.opened_at
          && previous.shift.opening_cash === shift.opening_cash
          && previous.serialized !== null && storage.getItem(SALE_SNAPSHOT_KEY) === previous.serialized) return;
        if (saveSaleSnapshot(storage, client, identity, shift)) {
          saved.current = { client, signature, shift, serialized: storage.getItem(SALE_SNAPSHOT_KEY) };
          dirty.current = false;
        }
      } catch { /* Stockage indisponible : conserver le dernier instantané connu. */ }
    };
    let disposed = false;
    let pending = false;
    const flush = () => {
      if (disposed || !pending) return;
      pending = false;
      save(); // Revalide l'identité, le cloud et le shift au moment de l'écriture.
    };
    const scheduleSave = () => {
      if (disposed || pending) return;
      pending = true;
      queueMicrotask(flush);
    };
    const unsubscribeQueries = client.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const key = event.query.queryKey as QueryKey;
      const shiftQuery = key.length === 3 && key[0] === 'pos_sessions' && key[1] === 'current' && key[2] === identity.user;
      if (!isSaleSnapshotQuery(key) && !shiftQuery) return;
      if (event.action.type !== 'success' && event.action.type !== 'error' && event.action.type !== 'setState') return;
      dirty.current = true;
      if (!useCloudStatusStore.getState().cloudOnline || !useAuthStore.getState().cloudValidated) {
        // Réparer uniquement la requête déjà connue qui vient d'échouer, sans
        // reparcourir le catalogue à chaque événement ni récursion globale.
        const state = event.query.state;
        if (isSaleSnapshotQuery(key) && state.status === 'error' && state.data !== undefined) {
          client.setQueryData(key, state.data, { updatedAt: state.dataUpdatedAt });
        }
        return;
      }
      scheduleSave();
    });
    const unsubscribeShift = useShiftStore.subscribe((state, previous) => {
      if (state.current !== previous.current) dirty.current = true;
      if (!state.current && previous.current) clearSaleSnapshot(storage);
      else if (state.current !== previous.current) scheduleSave();
    });
    // Une fermeture/recharge de l'onglet ne perd pas le dernier lot de données.
    window.addEventListener('pagehide', flush);
    save();
    return () => { disposed = true; unsubscribeQueries(); unsubscribeShift(); window.removeEventListener('pagehide', flush); };
  }, [client, terminal, pathname, cloudOnline, auth.cloudValidated, auth.bootstrapStatus, auth.isAuthenticated, auth.user, auth.sessionToken, auth.localSession, auth.isLocked]);

  // L'identité change aussi à la déconnexion : ne conserver aucun ancien manifeste.
  useEffect(() => useAuthStore.subscribe((state, previous) => {
    if (state.sessionToken !== previous.sessionToken || state.user?.id !== previous.user?.id) {
      try { clearSaleSnapshot(sessionStorage); } catch { /* Stockage inaccessible. */ }
    }
  }), []);

  return auth.isAuthenticated && !auth.isLocked && localSessionValid(auth.localSession, auth.sessionToken, auth.user?.id)
    ? (pathname === '/pos' || pathname === '/pos/') ? <PreloadSale />
      : pathname.startsWith('/tablet') ? <TabletOptionsPreload /> : null
    : null;
}
