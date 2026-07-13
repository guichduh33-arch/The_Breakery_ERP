// apps/pos/src/lib/kioskAuth.ts
// Session 13 / Phase 1.B — D18 + K7 (degraded mode).
//
// Shared kiosk auth core used by the display/ useKioskAuth hook (kds/tablet
// variants purged S76 — décision propriétaire 2026-07-13, re-spécifier si besoin).
// Per K7 (lead decision): if `kiosk-issue-jwt` is down, kiosk surfaces fall
// back to the staff PIN flow (existing useAuthStore.login). The hook surfaces
// that state so the UI can prompt for a PIN as a degraded escape hatch.
//
// Storage: kiosk_id + device_label persist in localStorage (long-lived ; an
// admin re-pairs when device is swapped). Kiosk JWT is held in memory + fed
// into the supabase client via setSupabaseKioskAccessToken.

import {
  issueKioskJwt,
  setSupabaseKioskAccessToken,
  type KioskScope,
  type KioskIssueResponse,
  type KioskIssueError,
} from '@breakery/supabase';
import { safeStorage, logger } from '@breakery/utils';

import { supabaseUrl } from './supabase.js';

const KIOSK_PAIR_STORAGE_KEY = 'breakery-pos-kiosk-pair';
// Refresh the kiosk JWT 10 minutes before expiry to absorb clock skew + jitter.
const REFRESH_SAFETY_MARGIN_SEC = 10 * 60;

export interface KioskPairing {
  kiosk_id: string;
  device_label?: string;
}

export interface KioskAuthState {
  status: 'idle' | 'authenticating' | 'authenticated' | 'failed' | 'pin_fallback';
  expiresAt: number | null;
  error: string | null;
}

/** Read the persisted pairing (or null when unpaired). */
export async function readKioskPairing(): Promise<KioskPairing | null> {
  try {
    const raw = await safeStorage.get(KIOSK_PAIR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KioskPairing;
    if (!parsed.kiosk_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the pairing locally. Admin-pair UI calls this. */
export async function writeKioskPairing(pair: KioskPairing): Promise<void> {
  await safeStorage.set(KIOSK_PAIR_STORAGE_KEY, JSON.stringify(pair));
}

/** Wipe the pairing (e.g. admin revoked the kiosk). */
export async function clearKioskPairing(): Promise<void> {
  await safeStorage.remove(KIOSK_PAIR_STORAGE_KEY);
  setSupabaseKioskAccessToken(null);
}

export interface ObtainKioskJwtResult {
  ok: true;
  response: KioskIssueResponse;
}

export interface ObtainKioskJwtFailure {
  ok: false;
  error: KioskIssueError | { error: string };
  status?: number | undefined;
}

/**
 * Try to obtain a kiosk JWT. On success, injects it into the supabase client
 * via setSupabaseKioskAccessToken and returns the response. On failure, returns
 * a typed error envelope so the caller can decide whether to fallback to PIN.
 */
export async function obtainKioskJwt(scope: KioskScope): Promise<ObtainKioskJwtResult | ObtainKioskJwtFailure> {
  const pair = await readKioskPairing();
  if (!pair) {
    return { ok: false, error: { error: 'kiosk_unpaired' } };
  }

  try {
    const req: { kiosk_id: string; scope: KioskScope; device_label?: string } = {
      kiosk_id: pair.kiosk_id,
      scope,
    };
    if (pair.device_label !== undefined) req.device_label = pair.device_label;
    const res = await issueKioskJwt(supabaseUrl, req);
    setSupabaseKioskAccessToken(res.access_token);
    logger.info('kiosk.jwt.issued', { scope, kiosk_id: pair.kiosk_id, expires_at: res.expires_at });
    return { ok: true, response: res };
  } catch (err: unknown) {
    const e = err as { details?: KioskIssueError; status?: number; message?: string };
    logger.warn('kiosk.jwt.failed', { scope, reason: e.details?.error ?? e.message });
    const failure: ObtainKioskJwtFailure = {
      ok: false,
      error: e.details ?? { error: e.message ?? 'kiosk_issue_failed' },
    };
    if (e.status !== undefined) failure.status = e.status;
    return failure;
  }
}

/**
 * Compute the delay (ms) before the next refresh tick. Returns null when the
 * expiry already passed (caller should re-mint immediately).
 */
export function nextRefreshDelayMs(expiresAtSec: number): number | null {
  const nowSec = Math.floor(Date.now() / 1000);
  const targetSec = expiresAtSec - REFRESH_SAFETY_MARGIN_SEC;
  if (targetSec <= nowSec) return null;
  return (targetSec - nowSec) * 1000;
}
