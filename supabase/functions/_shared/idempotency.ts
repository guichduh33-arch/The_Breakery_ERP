// supabase/functions/_shared/idempotency.ts
// S25 — read x-idempotency-key header, UUID v4 validation.
// Returns string|null. If `required: true` and header is absent, throws.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MissingIdempotencyKeyError extends Error {
  readonly code = 'missing_idempotency_key';
  constructor(message = 'x-idempotency-key header required') {
    super(message);
    this.name = 'MissingIdempotencyKeyError';
  }
}

export class InvalidIdempotencyKeyError extends Error {
  readonly code = 'invalid_idempotency_key';
  constructor(message = 'x-idempotency-key must be UUID v4') {
    super(message);
    this.name = 'InvalidIdempotencyKeyError';
  }
}

export function getIdempotencyKey(
  req: Request,
  opts: { required?: boolean } = {},
): string | null {
  const raw = req.headers.get('x-idempotency-key');
  if (!raw) {
    if (opts.required) throw new MissingIdempotencyKeyError();
    return null;
  }
  if (!UUID_REGEX.test(raw)) {
    throw new InvalidIdempotencyKeyError();
  }
  return raw;
}
