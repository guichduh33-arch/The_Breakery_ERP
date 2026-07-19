// apps/pos/src/lib/secureContextPolyfill.ts
//
// Spec 006x (validation boutique lot 1) — `crypto.randomUUID` n'existe que
// dans les contextes sécurisés (HTTPS ou localhost). Servi en LAN http
// (http://192.168.x.x — la mitigation §4.1 du hub), le navigateur le retire
// et l'app crashe au chargement du premier store qui l'appelle (page
// blanche, vu sur la caisse le 2026-07-19). `crypto.getRandomValues` reste
// disponible en contexte non sécurisé : on comble avec un v4 conforme
// RFC 4122. No-op en HTTPS/localhost. DOIT être le premier import de main.tsx.

type UuidString = `${string}-${string}-${string}-${string}-${string}`;

/** UUID v4 via getRandomValues — même contrat que crypto.randomUUID. */
export function randomUuidV4(): UuidString {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return [
    h.slice(0, 4).join(''),
    h.slice(4, 6).join(''),
    h.slice(6, 8).join(''),
    h.slice(8, 10).join(''),
    h.slice(10, 16).join(''),
  ].join('-') as UuidString;
}

if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  (crypto as Crypto & { randomUUID: () => UuidString }).randomUUID = randomUuidV4;
}
