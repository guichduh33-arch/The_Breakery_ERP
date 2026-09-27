// apps/pos/src/lib/kioskAuth.ts
// Identité d'appareil persistée ; aucun repli vers les droits d'un employé.
// Les anciens noms d'écran sans secret exigent un nouvel appairage.

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
// Renouvellement une minute avant expiration.
const REFRESH_SAFETY_MARGIN_SEC = 60;

export interface KioskPairing {
  kiosk_id: string;
  secret: string;
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
    if (!parsed.kiosk_id || typeof parsed.secret !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.secret)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the pairing locally. Admin-pair UI calls this. */
export async function writeKioskPairing(pair: KioskPairing): Promise<void> {
  const value = JSON.stringify(pair);
  await safeStorage.set(KIOSK_PAIR_STORAGE_KEY, value);
  if (await safeStorage.get(KIOSK_PAIR_STORAGE_KEY) !== value) throw new Error('Device storage unavailable');
}

/** Le secret est conservé avant l'échange pour permettre un retry réseau. */
export async function pairKiosk(code: string): Promise<void> {
  const key = `${KIOSK_PAIR_STORAGE_KEY}-pending-secret`;
  let secret = await safeStorage.get(key);
  if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
    secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    await safeStorage.set(key, secret);
    if (await safeStorage.get(key) !== secret) throw new Error('Device storage unavailable');
  }
  const result = await issueKioskJwt(supabaseUrl, { action: 'pair' }, { secret, pairingCode: code });
  await writeKioskPairing({ kiosk_id: result.kiosk.kiosk_id, secret });
  await safeStorage.remove(key);
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
 * Obtient un jeton limité. Le hook l'injecte seulement si la requête appartient
 * encore au composant monté, pour ignorer les réponses tardives.
 */
export async function obtainKioskJwt(scope: KioskScope): Promise<ObtainKioskJwtResult | ObtainKioskJwtFailure> {
  const pair = await readKioskPairing();
  if (!pair) {
    return { ok: false, error: { error: 'kiosk_unpaired' } };
  }

  try {
    if (scope !== 'display') return { ok: false, error: { error: 'invalid_scope' } };
    const res = await issueKioskJwt(supabaseUrl, { action: 'renew', device_id: pair.kiosk_id }, { secret: pair.secret });
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
