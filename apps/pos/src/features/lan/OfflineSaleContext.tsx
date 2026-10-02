import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import type { Product } from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { supabaseUrl } from '@/lib/supabase';
import { localSessionValid, isSameTabReload } from '@/features/auth/localSession';
import { useProducts } from '@/features/products/hooks/useProducts';
import { useStationMap } from '@/features/cart/hooks/useStationMap';
import { useCategories } from '@/features/products/hooks/useCategories';
import { useProductModifiers } from '@/features/products/hooks/useProductModifiers';
import { useProductVariants } from '@/features/products/hooks/useProductVariants';
import { useComboConfig } from '@/features/combos/hooks/useComboConfig';
import { useTaxConfig } from '@/features/settings/hooks/useTaxConfig';
import { useOfflineNetworkConfig } from '@/features/settings/hooks/useOfflineNetworkConfig';
import { useEnabledPaymentMethods } from '@/features/settings/hooks/useEnabledPaymentMethods';
import { useCurrentShift } from '@/features/shift/hooks/useShift';
import { usePromotions } from '@/features/promotions/hooks/usePromotions';
import { useLanCredential } from './lanCredential';
import { clearSaleSnapshot, restoreSaleSnapshot, saveSaleSnapshot, saleKeys, type SaleIdentity } from './offlineSaleSnapshot';
import { useCloudStatusStore } from './cloudStatusStore';

function Modifiers({ id, category }: { id: string; category: string | null }) {
  useProductModifiers({ productId: id, categoryId: category });
  return null;
}
function Combo({ id }: { id: string }) {
  // Inclut les modificateurs des composants dans la définition canonique.
  useComboConfig(id);
  return null;
}
function Variants({ product }: { product: Product }) {
  const { data = [] } = useProductVariants(product.id);
  return <>{data.map((variant) => <Modifiers key={variant.id} id={variant.id} category={product.category_id} />)}</>;
}
function PreloadSale() {
  const { data = [] } = useProducts();
  useStationMap();
  useCategories();
  useTaxConfig();
  useOfflineNetworkConfig();
  useEnabledPaymentMethods();
  useCurrentShift();
  usePromotions();
  return <>{data.map((product) => <div key={product.id} hidden>
    <Modifiers id={product.id} category={product.category_id} />
    {product.has_variants && <Variants product={product} />}
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
      if (current.isLocked || !current.cloudValidated || current.sessionToken !== identity.session) return;
      if (!localSessionValid(current.localSession, current.sessionToken, current.user?.id)) return;
      const shift = useShiftStore.getState().current;
      const verifiedShift = client.getQueryState<{ id: string } | null>(['pos_sessions', 'current', identity.user]);
      if (verifiedShift?.status !== 'success' || !shift || verifiedShift.data?.id !== shift.id) return;
      saveSaleSnapshot(storage, client, identity, shift);
    };
    const unsubscribeQueries = client.getQueryCache().subscribe(save);
    const unsubscribeShift = useShiftStore.subscribe((state, previous) => {
      if (!state.current && previous.current) clearSaleSnapshot(storage);
      else save();
    });
    save();
    return () => { unsubscribeQueries(); unsubscribeShift(); };
  }, [client, terminal, cloudOnline, auth.cloudValidated, auth.bootstrapStatus, auth.isAuthenticated, auth.user, auth.sessionToken, auth.localSession, auth.isLocked]);

  // L'identité change aussi à la déconnexion : ne conserver aucun ancien manifeste.
  useEffect(() => useAuthStore.subscribe((state, previous) => {
    if (state.sessionToken !== previous.sessionToken || state.user?.id !== previous.user?.id) {
      try { clearSaleSnapshot(sessionStorage); } catch { /* Stockage inaccessible. */ }
    }
  }), []);

  return auth.isAuthenticated && !auth.isLocked && localSessionValid(auth.localSession, auth.sessionToken, auth.user?.id)
    && pathname.startsWith('/pos')
    ? <PreloadSale /> : null;
}
