// apps/backoffice/src/pages/Login.tsx
//
// Écran « hors shell » : deux moitiés, l'encre porte la marque et les repères
// de déploiement, la lumière porte le geste. Le choix du compte et la saisie du
// PIN sont CO-PRÉSENTS — plus de modale, plus de pavé tactile (celui-ci reste
// le geste de la caisse, pas celui du Backoffice, qui n'a pas de cible
// tablette). Tout se fait au clavier.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore.js';
import { useLoginUsers } from '@/features/auth/hooks/useLoginUsers.js';

const PIN_LENGTH = 6;

// Constante de déploiement (ADR-019), pas un réglage à chaud : `business_config
// .timezone` est un miroir, pas l'autorité. Les repères ci-dessous sont calculés
// côté client — cet écran précède l'authentification et n'a droit à aucune
// donnée d'exploitation.
const BUSINESS_TZ = 'Asia/Makassar';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const isLoading = useAuthStore((s) => s.isLoading);

  const { data, isLoading: usersLoading, isError, refetch, isFetching } = useLoginUsers();
  const users = data ?? [];

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const pinRef = useRef<HTMLInputElement>(null);

  const selected = users.find((u) => u.id === selectedUserId) ?? null;

  // Horloge du jour métier — la minute suffit, on ne fait pas battre la seconde.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const day = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: BUSINESS_TZ,
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
        .format(now)
        .replace(',', '')
        .toUpperCase(),
    [now],
  );

  const time = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: BUSINESS_TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now),
    [now],
  );

  const env = import.meta.env.MODE;
  const isProd = env === 'production';

  function selectUser(userId: string) {
    setSelectedUserId(userId);
    setPin('');
    setError(null);
    // Le PIN prend le focus dès qu'un compte est choisi : l'opérateur enchaîne
    // sans toucher la souris.
    requestAnimationFrame(() => pinRef.current?.focus());
  }

  async function submit(value: string) {
    if (!selectedUserId || isLoading) return;
    setError(null);
    try {
      await login(selectedUserId, value);
      void navigate('/backoffice', { replace: true });
    } catch {
      // Message porté par le store. Les cellules se vident d'un coup et le focus
      // revient en tête — pas de secousse, ce monde est plat et sec.
      setPin('');
      pinRef.current?.focus();
    }
  }

  function handlePinChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setPin(next);
    if (error) setError(null);
    if (next.length === PIN_LENGTH) void submit(next);
  }

  function handlePinKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && pin.length === PIN_LENGTH) {
      event.preventDefault();
      void submit(pin);
    }
    if (event.key === 'Escape') {
      setSelectedUserId(null);
      setPin('');
      setError(null);
    }
  }

  return (
    <div className="login">
      <aside className="login-ink">
        <div className="login-brand">
          <img
            className="login-logo"
            src="/brand-logo-dark.png"
            alt="The Breakery"
            draggable={false}
          />
          <div className="login-surface">BACK OFFICE</div>
        </div>
        <dl className="login-markers">
          <div className="login-marker">
            <dt>DAY</dt>
            <dd>{day}</dd>
          </div>
          <div className="login-marker">
            <dt>TIME</dt>
            <dd>{time} WITA</dd>
          </div>
          {!isProd && (
            <div className="login-marker">
              <dt>ENVIRONMENT</dt>
              <dd className="is-env">{env.toUpperCase()}</dd>
            </div>
          )}
        </dl>
      </aside>

      <main className="login-light bg-page-grid">
        <div className="login-panel">
          <div>
            <p className="login-label" id="login-roster-label">
              SELECT USER
            </p>

            {usersLoading && <p className="login-hint">Loading staff…</p>}

            {isError && (
              <>
                <p className="login-error">Could not load staff. Check your connection.</p>
                <button
                  type="button"
                  className="login-retry"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                >
                  {isFetching ? 'Retrying…' : 'Retry'}
                </button>
              </>
            )}

            {!usersLoading && !isError && users.length === 0 && (
              <p className="login-hint">No active staff found.</p>
            )}

            {users.length > 0 && (
              <ul className="login-roster" aria-labelledby="login-roster-label">
                {users.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="login-row"
                      aria-pressed={u.id === selectedUserId}
                      onClick={() => selectUser(u.id)}
                      data-testid={`user-picker-${u.id}`}
                    >
                      <span className="login-name">{u.display_name}</span>
                      <span className="login-role">{u.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="login-rule"></div>

          <div>
            <p className="login-label">ENTER PIN</p>
            <div className="login-pin" data-disabled={selected ? 'false' : 'true'}>
              <div className="login-cells" aria-hidden="true">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <div
                    key={i}
                    className="login-cell"
                    data-active={i === Math.min(pin.length, PIN_LENGTH - 1) ? 'true' : 'false'}
                  >
                    {i < pin.length ? '•' : ''}
                  </div>
                ))}
              </div>
              <input
                ref={pinRef}
                className="login-pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={handlePinChange}
                onKeyDown={handlePinKeyDown}
                disabled={!selected || isLoading}
                aria-label={selected ? `PIN for ${selected.display_name}` : 'PIN'}
              />
            </div>

            {error ? (
              <p className="login-error" role="alert">
                {friendlyError(error)}
              </p>
            ) : (
              <p className="login-hint">
                {isLoading
                  ? 'Signing in…'
                  : selected
                    ? `Six digits for ${selected.display_name}.`
                    : 'Select a user to enter a PIN.'}
              </p>
            )}

            <p className="login-alt">
              Arrow keys and Tab move through the list, Enter selects. Escape clears the PIN.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function friendlyError(err: string): string {
  switch (err) {
    case 'invalid_pin':         return 'Wrong PIN. Try again.';
    case 'account_locked':      return 'Account locked. Try in 15 min.';
    case 'rate_limited':        return 'Too many attempts. Wait a moment.';
    case 'user_inactive':       return 'User inactive.';
    case 'user_not_found':      return 'User not found.';
    case 'invalid_pin_format':  return 'PIN must be 6 digits.';
    default:                    return 'Login failed.';
  }
}
