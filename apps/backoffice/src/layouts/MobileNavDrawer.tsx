// apps/backoffice/src/layouts/MobileNavDrawer.tsx
//
// Audit UX/UI 2026-08-13 (lot 2) — repli de la navigation sous 1024 px.
//
// La top bar n'avait AUCUN comportement responsive : sous ~1024 px les onglets
// se comprimaient jusqu'au chevauchement. Sous `lg`, la nav horizontale
// disparaît et ce tiroir la remplace : un bouton burger ouvre un `Sheet`
// latéral gauche qui rend la MÊME source (`visibleDomains`, donc le même
// filtrage par permission) — aucun état de navigation dupliqué.
//
// Patron : apps/pos SideMenuDrawer (Sheet side="left", p-0, flex-col,
// SheetTitle/Description en sr-only pour Radix).

import { useState, type JSX } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle, cn } from '@breakery/ui';
import type { NavDomain } from './nav.js';

export interface MobileNavDrawerProps {
  domains: NavDomain[];
  /** Domaine possédant la route courante — surligné dans la liste. */
  activeId: string | null;
}

export function MobileNavDrawer({ domains, activeId }: MobileNavDrawerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const closeAnd = () => { setOpen(false); };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); }}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-sm text-ink-fg-dim transition-colors hover:text-ink-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-gold lg:hidden"
      >
        <Menu className="h-[18px] w-[18px]" aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-[300px] max-w-none flex-col p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Primary navigation</SheetDescription>
          <nav aria-label="Primary" className="flex-1 overflow-y-auto px-4 py-4">
            {domains.map((domain) => {
              if (domain.columns === undefined) {
                return (
                  <NavLink
                    key={domain.id}
                    to={domain.to ?? '/backoffice'}
                    {...(domain.end === true ? { end: true } : {})}
                    onClick={closeAnd}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center rounded-sm px-2 py-2 text-sm font-medium transition-colors',
                        isActive ? 'text-gold' : 'text-text-primary hover:text-gold',
                      )
                    }
                  >
                    {domain.label}
                  </NavLink>
                );
              }
              return (
                <section key={domain.id} className="mt-3 first:mt-0">
                  <p
                    className={cn(
                      'px-2 pb-1 pt-2 font-data text-xs uppercase tracking-widest',
                      domain.id === activeId ? 'text-gold' : 'text-text-muted',
                    )}
                  >
                    {domain.label}
                  </p>
                  {domain.columns.map((column) => (
                    <ul key={column.label} className="mb-1.5">
                      {column.links.map((link) => (
                        <li key={link.to}>
                          <NavLink
                            to={link.to}
                            {...(link.end === true ? { end: true } : {})}
                            onClick={closeAnd}
                            className={({ isActive }) =>
                              cn(
                                'flex items-center rounded-sm px-2 py-1.5 text-[13px] leading-tight transition-colors',
                                isActive
                                  ? 'font-medium text-gold'
                                  : 'text-text-primary hover:text-gold',
                              )
                            }
                          >
                            {link.label}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  ))}
                </section>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
