/**
 * Une commande encore « en vol » : ni encaissée, ni close, ni annulée.
 *
 * C'est la seule population sur laquelle une serveuse peut encore agir — donc
 * la seule qui mérite un badge. Compter tout l'historique donnait un nombre qui
 * ne cesse de croître, et un compteur qui n'indique rien d'actionnable cesse
 * d'être regardé.
 */
export function isInFlight(status: string): boolean {
  return status !== 'paid' && status !== 'completed' && status !== 'voided';
}
