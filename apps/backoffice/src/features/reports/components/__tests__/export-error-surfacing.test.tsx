// Un export qui échoue doit le DIRE — filet de régression pour ExportButtons
// et ExportMenu, partagés par quarante-quatre pages du back-office.
//
// POURQUOI CE FICHIER EXISTE. Ces deux composants ont porté, jusqu'au lot
// « export error surfacing », DEUX silences distincts — l'utilisateur cliquait
// « Export », rien ne se produisait, aucun message :
//
//   1. Le PDF. Le handler est async et appelé depuis
//      `onClick={() => { void handlePdf(); }}`. Sans `try/catch` autour de
//      `await generatePdf.mutateAsync(...)`, le `void` avale le rejet.
//      AUCUN filet du dépôt n'attrape ça : eslint est aveugle, `void` étant
//      précisément l'échappatoire documentée de `no-floating-promises`. Une
//      garde verte ne prouve rien sur cette classe de défaut — seul un test qui
//      force le rejet et vérifie ce qui atteint l'écran la voit.
//
//   2. Le CSV, et c'est le plus discret : il est SYNCHRONE. `buildCsv` appelle
//      `column.accessor(row)` sur chaque ligne ; un accessor qui lève (donnée
//      inattendue, champ absent) jette dans un handler d'événement React — que
//      les error boundaries NE CAPTENT PAS. L'exception part dans
//      `window.onerror`, l'écran ne bouge pas, aucun fichier n'est téléchargé.
//
// CE QUE LES CAS VERROUILLENT. Le message nomme l'export qui a échoué et dit
// quelque chose d'utile — jamais un jeton interne.
//
// Le piège, ici, est que le champ `error` de l'EF `generate-pdf` ne contient
// JAMAIS de prose : ce sont douze codes machine (`permission_denied`,
// `generation_failed`, `sign_url_failed`…) que `useGeneratePdf` propage tels
// quels. Un test dont la fixture renvoie « Period is not closed » valide donc un
// contrat imaginaire et ne peut pas voir la fuite. Les cas ci-dessous rejouent
// de VRAIS codes de l'EF et exigent la phrase — puis vérifient que le code
// lui-même n'atteint pas l'écran. Même exigence pour la sentinelle `pdf_failed`
// et pour `[object Object]`.
//
// Le déclencheur revient au repos après l'échec. Et le dernier cas est le
// garde-fou du chemin HEUREUX : c'est celui qu'on serait tenté de couper, et
// c'est lui qui prouve qu'un correctif d'erreur n'a pas déplacé le
// téléchargement, l'URL signée ni les flags d'ouverture.
//
// Les assertions sont DISCRIMINANTES : mesurées sur le code d'avant correctif,
// cinq des six cas échouent, seul le cas de succès passe. Les relâcher (accepter
// n'importe quel toast, retirer les négations) rendrait ce fichier décoratif.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { toast } from 'sonner';
import { ExportButtons } from '../ExportButtons.js';
import { ExportMenu } from '../ExportMenu.js';
import { useAuthStore } from '@/stores/authStore.js';

// Sonner — on capture les appels, aucune notification DOM n'est nécessaire ici.
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// useGeneratePdf appelle l'EF en fetch direct (pattern money-path du POS) :
// on mocke l'URL, le helper de token PIN-first, et le fetch global.
vi.mock('@/lib/supabase.js', () => ({ supabaseUrl: 'http://test.local' }));
vi.mock('@/lib/accessToken.js', () => ({ getAccessToken: () => Promise.resolve('t') }));

const fetchMock = vi.fn();
Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

const toastError = vi.mocked(toast.error);

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const PDF = {
  template: 'pnl' as const,
  data: { revenue: { total: 100 } },
  period: { start: '2026-05-01', end: '2026-05-31' },
  filename: 'pnl-2026-05',
};

// Ce fichier teste le CÂBLAGE de l'erreur, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  toastError.mockClear();
  fetchMock.mockReset();
});

describe('export failures reach the user', () => {
  it('ExportButtons — a real EF error code becomes a sentence, button returns to rest', async () => {
    // `permission_denied` est un code que l'EF `generate-pdf` produit VRAIMENT
    // (elle vérifie `reports.export` ET le droit du template). Une fixture qui
    // renverrait une phrase toute faite validerait un contrat imaginaire : le
    // champ `error` de cette EF ne contient jamais de prose.
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'permission_denied' }) });
    render(wrap(<ExportButtons pdf={PDF} />));
    fireEvent.click(screen.getByTestId('export-pdf'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'PDF export failed: you do not have permission to export this report.',
    ));
    // Le code machine lui-même n'atteint jamais l'écran.
    expect(toastError.mock.calls.map((c) => (typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0]))).join(' ')).not.toContain('permission_denied');
    // Pas de bouton coincé sur « Generating… » : plus de disabled, plus de spinner.
    await waitFor(() => expect(screen.getByTestId('export-pdf')).not.toBeDisabled());
    expect(document.querySelector('.animate-spin')).toBeNull();
  });

  it('ExportButtons — no server message: no jargon, no [object Object]', async () => {
    // L'EF répond en erreur sans corps JSON exploitable : useGeneratePdf lève
    // alors sa sentinelle `pdf_failed`, qui ne doit jamais atteindre l'écran.
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('not json')) });
    render(wrap(<ExportButtons pdf={PDF} />));
    fireEvent.click(screen.getByTestId('export-pdf'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('PDF export failed. Please try again.'));
    const shown = toastError.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0])))
      .join(' ');
    expect(shown).not.toContain('[object Object]');
    expect(shown).not.toContain('pdf_failed');
  });

  it('ExportMenu — a real EF error code becomes a sentence, item returns to rest', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'generation_failed' }) });
    render(wrap(<ExportMenu pdf={PDF} />));
    fireEvent.click(screen.getByTestId('export-menu'));
    fireEvent.click(screen.getByTestId('export-pdf'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'PDF export failed: the report could not be rendered.',
    ));
    expect(toastError.mock.calls.map((c) => (typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0]))).join(' ')).not.toContain('generation_failed');
    await waitFor(() => expect(screen.getByTestId('export-pdf')).not.toBeDisabled());
  });

  // Chemin CSV : synchrone, hors de portée des error boundaries (cf. en-tête).
  it('ExportButtons — CSV accessor throwing is surfaced too', () => {
    render(wrap(<ExportButtons csv={{
      rows: [{ a: 1 }],
      columns: [{ header: 'A', accessor: () => { throw new Error('bad row'); } }],
      filename: 'test-csv',
    }} />));
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(toastError).toHaveBeenCalledWith('CSV export failed: bad row');
  });

  it('ExportMenu — CSV accessor throwing is surfaced too', () => {
    render(wrap(<ExportMenu csv={{
      rows: [{ a: 1 }],
      columns: [{ header: 'A', accessor: () => { throw new Error('bad row'); } }],
      filename: 'test-csv',
    }} />));
    fireEvent.click(screen.getByTestId('export-menu'));
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(toastError).toHaveBeenCalledWith('CSV export failed: bad row');
  });

  // NE PAS SUPPRIMER : seul garant que le traitement d'erreur n'a pas déplacé
  // le chemin de succès (URL signée ouverte, mêmes flags, aucun toast parasite).
  it('SUCCESS path unchanged — signed_url still opened, no toast', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ signed_url: 'https://example.test/x', storage_path: 'p', expires_at: 'z' }),
    });
    render(wrap(<ExportButtons pdf={PDF} />));
    fireEvent.click(screen.getByTestId('export-pdf'));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://example.test/x', '_blank', 'noopener,noreferrer'));
    expect(toastError).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
