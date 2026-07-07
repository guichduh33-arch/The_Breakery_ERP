// apps/pos/src/features/customers/avatarTint.ts
//
// Shared avatar-tint helper for customer initials (POS). Before this, the
// customer badge and the attach-modal each duplicated a 5-entry palette of
// raw `bg-*-500 text-white` classes. This centralises it onto the
// theme-aware categorical ramp (`cat-*`) so the initial stays legible in
// both light and dark, and both surfaces stay in sync.
//
// Background + foreground share the same hue (soft translucent fill, solid
// text) mirroring the documented `bg-cat-rose/20 text-cat-rose` pattern.

/**
 * 5 distinct categorical tints. Avatar color is computed from a stable hash
 * of the seed (customer id) so the same customer always gets the same hue
 * across mounts.
 */
const AVATAR_TINTS = [
  'bg-cat-emerald/20 text-cat-emerald',
  'bg-cat-blue/20 text-cat-blue',
  'bg-cat-rose/20 text-cat-rose',
  'bg-cat-amber/20 text-cat-amber',
  'bg-cat-violet/20 text-cat-violet',
] as const;

export function avatarTint(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length] as string;
}
