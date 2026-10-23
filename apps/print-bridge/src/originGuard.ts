// Origines web admises par le pont, sur HTTP comme à l'upgrade /ws.
//
// HUB_ALLOWED_ORIGINS filtre les pages servies AILLEURS. Une page que le pont
// sert lui-même (SPA POS, POS_DIST_DIR) appelle son propre hôte : refuser sa
// propre origine bloquait ses scripts (403 origin_forbidden, écran blanc) et son
// hub temps réel dès que l'URL de caisse changeait de port ou de nom.
//
// Un rebinding DNS ne peut pas usurper cette origine : en production le pont
// refuse de démarrer sans TLS (server.ts), et son certificat est lié à son nom.
// Une requête sans Origin (client non navigateur) passait déjà : rien ne s'ouvre
// de plus de ce côté-là.

/** Origine du pont vue par la requête : schéma de la connexion + en-tête Host. */
export function ownOrigin(encrypted: boolean, host: string | undefined): string | null {
  if (!host) return null;
  return `${encrypted ? 'https' : 'http'}://${host.toLowerCase()}`;
}

export function isAllowedOrigin(
  origin: string | undefined,
  own: string | null,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  return own !== null && origin.toLowerCase() === own;
}
