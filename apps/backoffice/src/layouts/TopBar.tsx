// apps/backoffice/src/layouts/TopBar.tsx
//
// Refonte shell 2026-08-05 — la top bar encre du Backoffice.
//
// Remplace À ELLE SEULE l'ancien couple Sidebar (rail de 240 px, 8 groupes
// accordéon, ~85 entrées) + Topbar (bandeau de 56 px). La navigation tient
// désormais dans 52 px de haut : 7 onglets de domaine, chacun ouvrant un
// drop-panel (`DomainPanel`). La largeur entière de la page revient aux données.
//
// Le patron est un DISCLOSURE, pas un menubar. Le commentaire qui annonçait
// ici un « comportement de menubar standard » avait fait poser un
// `aria-haspopup="true"` sur les onglets — valeur SYNONYME de `"menu"`, qui
// promet un `role="menu"` et des `role="menuitem"` que `DomainPanel` n'a
// jamais eus : c'est une grille de colonnes de `<ul>/<li>/<a>`. L'attribut est
// retiré ; `aria-expanded` + `aria-controls` décrivent exactement ce qui se
// passe. C'est le patron « Disclosure Navigation Menu » de l'APG, conçu pour
// un panneau de LIENS — et qui laisse aux liens leur rôle `link`, ce que la
// structure de menu leur ferait perdre (au prix, en plus, d'un tabindex
// tournant, de ↑/↓ internes, de Début/Fin et de la saisie prédictive).
//
// Ce que le code fait réellement :
//   · clic sur un onglet → ouvre son panneau ; re-clic, Échap ou clic extérieur → ferme
//   · la barre étant DÉJÀ ouverte, le survol d'un autre onglet bascule le panneau sans clic
//   · ← / → déplacent le focus entre onglets, ↓ entre dans le panneau ouvert
//     (ces trois flèches sont un SUPPLÉMENT au disclosure, pas une obligation
//     du patron)
//
// Le panneau est rendu DANS le `<nav aria-label="Primary">` : posé en dehors,
// ses ~85 destinations n'appartenaient à aucun repère, et la « liste des
// repères » d'un lecteur d'écran ne trouvait que les 7 onglets.
//
// L'onglet ACTIF (section courante) et l'onglet OUVERT (panneau affiché) sont
// deux états distincts qui se cumulent : le soulignement or dit « vous êtes
// ici », le fond relevé dit « ce menu est déployé ».

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Search, Settings } from 'lucide-react';
import { cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { roleLabel } from '@/lib/roleLabels.js';
import { DomainPanel } from './DomainPanel.js';
import { MobileNavDrawer } from './MobileNavDrawer.js';
import { NAV_DOMAINS, activeDomainId, visibleDomains, type NavDomain } from './nav.js';

// Le glyphe ⌘ ne dit rien à un poste Windows/Linux — on affiche Ctrl+K hors
// macOS (audit UX/UI 2026-08-13, lot 2). `userAgentData.platform` d'abord,
// `navigator.platform` (déprécié mais universel) en repli ; évalué une fois,
// la plateforme ne change pas en cours de session. L'`aria-keyshortcuts` de la
// TopBar liste déjà les deux variantes, lui n'a pas à choisir.
function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaPlatform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform;
  return /mac/i.test(uaPlatform);
}
const SEARCH_KBD = isMacPlatform() ? '⌘K' : 'Ctrl+K';

function UserChip() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node) === false) setOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const logoutAndLeave = async () => {
    setBusy(true);
    try {
      await logout();
      await navigate('/login', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  if (user === null) return null;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-sm p-1 transition-colors hover:bg-ink-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-gold"
      >
        <span
          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full bg-ink-raised text-xs font-semibold text-ink-fg-muted"
          aria-hidden
        >
          {user.full_name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden text-sm text-ink-fg sm:inline">{user.full_name}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 rounded-xl border border-border-strong bg-surface-3 py-1.5 shadow-[0_18px_40px_rgba(28,23,18,0.20)]"
        >
          <p className="px-3.5 pb-1.5 pt-1 font-data text-xs uppercase tracking-widest text-text-muted">
            {roleLabel(user.role_code)}
          </p>
          <Link
            to="/backoffice/settings"
            role="menuitem"
            onClick={() => { setOpen(false); }}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-primary transition-colors hover:bg-surface-4"
          >
            <Settings className="h-4 w-4 text-text-muted" aria-hidden /> Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => { void logoutAndLeave(); }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-4 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 text-text-muted" aria-hidden /> Logout
          </button>
        </div>
      )}
    </div>
  );
}

export interface TopBarProps {
  /** Ouvre la palette de commandes (⌘K) — état propriété du layout. */
  onOpenSearch: () => void;
}

export function TopBar({ onOpenSearch }: TopBarProps) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { pathname } = useLocation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [anchorLeft, setAnchorLeft] = useState(0);

  const shellRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLElement | null>());

  const domains = visibleDomains(NAV_DOMAINS, hasPermission);
  const activeId = activeDomainId(domains, pathname);
  const openDomain: NavDomain | undefined = domains.find((d) => d.id === openId);

  const close = useCallback(() => { setOpenId(null); }, []);

  // Le panneau se ferme quand la route change : on vient de naviguer.
  useEffect(() => { setOpenId(null); }, [pathname]);

  // Clic extérieur + Échap. Portés par le shell entier (barre + panneau) pour
  // qu'un clic DANS le panneau ne le referme pas avant que le lien ne parte.
  useEffect(() => {
    if (openId === null) return;
    const onPointerDown = (e: MouseEvent) => {
      if (shellRef.current?.contains(e.target as Node) === false) close();
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        tabRefs.current.get(openId)?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openId, close]);

  function openAt(domain: NavDomain, el: HTMLElement | null) {
    setAnchorLeft(el?.getBoundingClientRect().left ?? 0);
    setOpenId(domain.id);
  }

  function onTabKeyDown(e: ReactKeyboardEvent, index: number, domain: NavDomain) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const next = domains[(index + delta + domains.length) % domains.length];
      if (next !== undefined) tabRefs.current.get(next.id)?.focus();
      return;
    }
    if (e.key === 'ArrowDown' && domain.columns !== undefined) {
      e.preventDefault();
      if (openId !== domain.id) openAt(domain, tabRefs.current.get(domain.id) ?? null);
      // Le panneau vient (ou va) d'être monté — on attend le frame suivant pour
      // donner le focus à son premier lien.
      requestAnimationFrame(() => {
        document
          .getElementById(`domain-panel-${domain.id}`)
          ?.querySelector<HTMLAnchorElement>('a[href]')
          ?.focus();
      });
    }
  }

  const tabBase =
    'relative flex h-[52px] items-center gap-1 whitespace-nowrap px-[13px] text-sm transition-colors ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-gold';

  return (
    <div ref={shellRef} className="relative shrink-0">
      {/* Filet or sous l'encre (direction « Instrument », maquette 3a) : il ferme
          la barre sur le fond de page clair. Sans lui, l'encre et l'ivoire se
          touchent à cru et la barre paraît posée sur la page au lieu d'en être
          le bord. */}
      <header className="flex h-[52px] items-center gap-[22px] border-b border-gold bg-ink px-[22px] max-lg:gap-3 max-lg:px-4">
        <MobileNavDrawer domains={domains} activeId={activeId} />
        <Link
          to="/backoffice"
          className="flex shrink-0 items-center gap-2.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-gold"
        >
          {/* `font-brand` et non `font-display` : sous `.theme-backoffice`,
              `--font-display` est remappé sur la pile du CORPS (colors.css), et
              le monogramme rendait donc en Instrument Sans — le seul endroit du
              back-office où Playfair devait survivre était précisément celui qui
              ne le rendait pas (relevé du 2026-08-18). `--font-brand` n'est
              jamais remappé ; l'utilitaire qui l'expose a été ajouté au preset
              le même jour. L'APLAT d'or reste un arbitrage du propriétaire,
              consigné en exception dans DESIGN.md. */}
          <span
            className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-sm bg-gold font-brand text-sm leading-none text-ink-fg"
            aria-hidden
          >
            B
          </span>
          <span className="text-sm font-semibold text-ink-fg">The Breakery</span>
        </Link>

        <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center lg:flex">
          {domains.map((domain, index) => {
            const isActive = domain.id === activeId;
            const isOpen = domain.id === openId;
            const stateClass = cn(
              isOpen && 'bg-ink-hover text-ink-fg',
              !isOpen && isActive && 'font-medium text-ink-fg',
              !isOpen && !isActive && 'text-ink-fg-dim hover:text-ink-fg',
              isActive && 'shadow-[inset_0_-2px_0_var(--ink-gold)]',
            );

            if (domain.columns === undefined) {
              return (
                <NavLink
                  key={domain.id}
                  to={domain.to ?? '/backoffice'}
                  {...(domain.end === true ? { end: true } : {})}
                  ref={(el) => { tabRefs.current.set(domain.id, el); }}
                  onMouseEnter={() => { if (openId !== null) close(); }}
                  onKeyDown={(e) => { onTabKeyDown(e, index, domain); }}
                  className={cn(tabBase, stateClass)}
                >
                  {domain.label}
                </NavLink>
              );
            }

            return (
              <button
                key={domain.id}
                type="button"
                ref={(el) => { tabRefs.current.set(domain.id, el); }}
                aria-expanded={isOpen}
                aria-controls={isOpen ? `domain-panel-${domain.id}` : undefined}
                onClick={(e) => {
                  if (isOpen) close();
                  else openAt(domain, e.currentTarget);
                }}
                onMouseEnter={(e) => {
                  // Bascule au survol seulement si la barre est DÉJÀ déployée.
                  if (openId !== null && !isOpen) openAt(domain, e.currentTarget);
                }}
                onKeyDown={(e) => { onTabKeyDown(e, index, domain); }}
                className={cn(tabBase, stateClass)}
              >
                {domain.label}
                <ChevronDown className="h-[13px] w-[13px]" aria-hidden />
              </button>
            );
          })}

          {/* Le panneau vit DANS le repère de navigation (voir l'en-tête). Il
              reste en `position: absolute` : ni `<header>` ni `<nav>` ne crée
              de contexte d'empilement (aucun z-index, aucune transformation),
              son ancêtre positionné demeure le shell `relative` — la mise en
              page et le `z-40` sont inchangés. */}
          {openDomain?.columns !== undefined && (
            <DomainPanel
              domain={openDomain}
              anchorLeft={anchorLeft}
              onClose={close}
              id={`domain-panel-${openDomain.id}`}
            />
          )}
        </nav>

        {/* La nav horizontale disparaît sous lg : ce ressort garde le bloc
            recherche/profil collé à droite. */}
        <div className="flex-1 lg:hidden" aria-hidden />

        <div className="flex shrink-0 items-center gap-4 max-lg:gap-2">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-[30px] items-center gap-2 rounded-sm border border-ink-border px-2.5 text-ink-fg-sub transition-colors hover:text-ink-fg-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-gold"
            aria-label="Search — open the command palette"
            aria-keyshortcuts="Meta+K Control+K"
          >
            <Search className="h-[14px] w-[14px]" aria-hidden />
            <span className="hidden text-sm lg:inline">Search</span>
            <kbd className="hidden font-data text-xs tracking-wide lg:inline">{SEARCH_KBD}</kbd>
          </button>

          <UserChip />
        </div>
      </header>
    </div>
  );
}
