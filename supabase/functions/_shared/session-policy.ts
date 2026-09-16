export interface SessionPolicyInput {
  created_at: string;
  last_activity_at: string;
  ended_at: string | null;
  session_timeout_minutes: number | null;
  permissions_snapshot: string[] | null;
}

/** Politique pure, horloge injectable ; la restauration ne constitue pas une activité. */
export function sessionRejection(session: SessionPolicyInput, now: number): string | null {
  if (session.ended_at !== null) return 'session_expired';
  const minutes = session.session_timeout_minutes;
  if (!Number.isInteger(minutes) || minutes === null || minutes < 5 || minutes > 480
      || !Array.isArray(session.permissions_snapshot)
      || !session.permissions_snapshot.every((permission) => typeof permission === 'string')) {
    return 'session_snapshot_required';
  }
  const created = Date.parse(session.created_at);
  const activity = Date.parse(session.last_activity_at);
  if (!Number.isFinite(created) || !Number.isFinite(activity) || created > now || activity > now) {
    return 'session_expired';
  }
  if (now - created >= 24 * 60 * 60 * 1000) return 'session_expired';
  if (now - activity >= minutes * 60 * 1000) return 'session_timeout';
  return null;
}
