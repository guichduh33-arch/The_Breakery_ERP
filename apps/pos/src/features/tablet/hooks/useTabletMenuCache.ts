// apps/pos/src/features/tablet/hooks/useTabletMenuCache.ts
//
// Session 13 / Phase 4.D — Tablet polish.
//
// Lightweight read-through cache for the tablet menu (categories + products).
// Lives in `localStorage` rather than IndexedDB to keep the read path
// synchronous and the implementation thin — the entire menu rarely exceeds
// 50 KB for a single store and the kiosk only ever has one tenant at a time.
//
// Strategy:
//   - On every successful fetch (categories OR products), write through to
//     localStorage with a UTC timestamp.
//   - When asked for the cached snapshot, return whichever data is fresh
//     (within `MAX_AGE_MS`) regardless of whether the network is online.
//   - When the snapshot is stale or missing, return `null` so the caller
//     can decide what to render (typically a "menu unavailable offline"
//     state — but cache only ever expires after 24h, so practically this
//     only kicks in on first-mount-without-network).
//
// The hook is intentionally NOT a React Query wrapper around its own
// queryKey — that would deadlock with `useProducts`/`useCategories`. It is
// a side-effect observer that watches the existing queries and a getter
// that returns cached data on demand.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Category, Product } from '@breakery/domain';

const STORAGE_KEY = 'tablet-menu-cache-v1';
const MAX_AGE_MS  = 24 * 60 * 60 * 1000; // 24h

interface MenuSnapshot {
  cachedAt:    string;
  version:     1;
  categories:  Category[];
  products:    Product[];
}

function readSnapshot(): MenuSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as MenuSnapshot;
    if (parsed.version !== 1) return null;
    const age = Date.now() - new Date(parsed.cachedAt).getTime();
    if (age > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: Omit<MenuSnapshot, 'version' | 'cachedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: MenuSnapshot = {
      version:    1,
      cachedAt:   new Date().toISOString(),
      categories: snap.categories,
      products:   snap.products,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded / private browsing — degrade silently. The live
    // query still works ; cache is best-effort.
  }
}

export interface TabletMenuCache {
  /** Categories from the most recent successful fetch, or `[]` if no cache. */
  cachedCategories: Category[];
  /** Products from the most recent successful fetch, or `[]` if no cache. */
  cachedProducts:   Product[];
  /** ISO timestamp of when the cache was last written, or null. */
  cachedAt:         string | null;
}

/**
 * Read-only cache accessor. Returns the latest valid snapshot, or empty
 * arrays if there is no usable cache.
 */
export function useTabletMenuCacheRead(): TabletMenuCache {
  const snap = readSnapshot();
  return {
    cachedCategories: snap?.categories ?? [],
    cachedProducts:   snap?.products   ?? [],
    cachedAt:         snap?.cachedAt   ?? null,
  };
}

/**
 * Side-effect hook : watches the `['products']` and `['categories']` query
 * caches and persists the latest snapshot to localStorage. Mount once
 * inside the tablet menu shell.
 */
export function useTabletMenuCacheWriter(): void {
  const qc = useQueryClient();

  useEffect(() => {
    function maybePersist(): void {
      const categories = qc.getQueryData<Category[]>(['categories']);
      const products   = qc.getQueryData<Product[]>(['products']);
      if (categories !== undefined && products !== undefined) {
        writeSnapshot({ categories, products });
      }
    }

    // Initial — in case the queries are already hydrated.
    maybePersist();

    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const key = event.query.queryKey;
      if (Array.isArray(key) && (key[0] === 'products' || key[0] === 'categories')) {
        maybePersist();
      }
    });

    return () => { unsubscribe(); };
  }, [qc]);
}
