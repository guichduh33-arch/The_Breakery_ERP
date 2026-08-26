// packages/utils/src/__tests__/dates.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatDate, formatDateTime, formatDateTimeWita, formatDateTimeShortWita, formatTimeWita, formatDateLong, todayIsoDate, monthStartIsoDate, businessDateIso } from '../dates';

describe('dates', () => {
  const utc = new Date('2026-05-03T10:30:00Z');  // 18:30 WITA

  it('formatDateTimeWita renders WITA', () => {
    expect(formatDateTimeWita(utc)).toBe('2026-05-03 18:30:00');
  });

  it('formatDateTimeShortWita renders dd MMM yyyy, HH:mm WITA', () => {
    expect(formatDateTimeShortWita(utc)).toBe('03 May 2026, 18:30');
  });

  // Le mois en lettres est la raison d'être du helper : un 03/05 rendu par le
  // navigateur se lit 3 mai ou 5 mars selon la locale.
  it('formatDateTimeShortWita names the month rather than numbering it', () => {
    expect(formatDateTimeShortWita('2026-08-03T19:47:02Z')).toBe('04 Aug 2026, 03:47');
  });

  it('formatTimeWita renders HH:mm WITA', () => {
    expect(formatTimeWita(utc)).toBe('18:30');
  });

  // Audit UX/UI lot 5 — jj/MM/aaaa, jamais l'ordre US ; le fuseau reste WITA
  // (un instant tard le soir UTC appartient au lendemain métier).
  it('formatDate renders dd/MM/yyyy WITA', () => {
    expect(formatDate(utc)).toBe('03/05/2026');
    expect(formatDate('2026-08-03T19:47:02Z')).toBe('04/08/2026');
  });

  it('formatDateTime is the canonical table format', () => {
    expect(formatDateTime(utc)).toBe('03 May 2026, 18:30');
  });

  it('formatDateLong renders Month d, yyyy', () => {
    expect(formatDateLong(utc)).toMatch(/^May \d+, 2026$/);
  });

  it('todayIsoDate returns YYYY-MM-DD', () => {
    expect(todayIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // monthStartIsoDate — la borne basse par défaut des périodes comptables.
  // Les instants choisis sont ceux où le fuseau MORD : entre minuit et 08 h à
  // Makassar, l'UTC est encore la veille, donc un `toISOString()` rendait un
  // jour — et parfois un MOIS — antérieurs.
  describe('monthStartIsoDate', () => {
    afterEach(() => { vi.useRealTimers(); });

    function at(iso: string): void {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(iso));
    }

    it('rend le premier jour du mois, au format ISO', () => {
      expect(monthStartIsoDate()).toMatch(/^\d{4}-\d{2}-01$/);
    });

    // LE DÉFAUT. 2026-07-31 16:30 UTC = 2026-08-01 00:30 à Makassar : le mois
    // métier vient de changer, l'UTC pas encore. L'ancien calcul rendait
    // « 2026-07-31 », donc une période d'ouverture qui commençait un mois trop
    // tôt ET un jour trop tôt.
    it('reste sur le mois MÉTIER quand l’UTC est encore au mois précédent', () => {
      at('2026-07-31T16:30:00Z');
      expect(monthStartIsoDate()).toBe('2026-08-01');
      expect(todayIsoDate()).toBe('2026-08-01');
      // Le témoin du bug : la voie UTC, elle, se trompe de mois.
      expect(new Date().toISOString().slice(0, 10)).toBe('2026-07-31');
    });

    it('ne dérive pas en milieu de mois', () => {
      at('2026-08-14T16:30:00Z'); // 2026-08-15 00:30 WITA
      expect(monthStartIsoDate()).toBe('2026-08-01');
      expect(todayIsoDate()).toBe('2026-08-15');
    });

    it('borne basse et borne haute appartiennent toujours au même mois', () => {
      for (const iso of ['2026-01-31T17:00:00Z', '2026-02-28T16:00:00Z', '2026-12-31T23:59:00Z']) {
        at(iso);
        expect(monthStartIsoDate().slice(0, 7)).toBe(todayIsoDate().slice(0, 7));
        vi.useRealTimers();
      }
    });
  });

  it('accepts string input for formatDateTimeWita', () => {
    expect(formatDateTimeWita('2026-05-03T10:30:00Z')).toBe('2026-05-03 18:30:00');
  });

  it('accepts string input for formatTimeWita', () => {
    expect(formatTimeWita('2026-05-03T10:30:00Z')).toBe('18:30');
  });

  it('accepts string input for formatDateLong', () => {
    expect(formatDateLong('2026-05-03T10:30:00Z')).toMatch(/^May \d+, 2026$/);
  });

  // businessDateIso — le jour MÉTIER d'un instant quelconque. Sa raison d'être
  // est de comparer des journées de travail, pas des tranches de 24 h.
  describe('businessDateIso', () => {
    it('rend le jour WITA et non le jour UTC', () => {
      // 2026-08-03 19:47 UTC = 2026-08-04 03:47 à Makassar : la journée a changé.
      expect(businessDateIso('2026-08-03T19:47:02Z')).toBe('2026-08-04');
    });

    it('garde le même jour quand le décalage ne fait pas basculer la date', () => {
      expect(businessDateIso('2026-05-03T10:30:00Z')).toBe('2026-05-03');
    });

    // Le défaut d'origine : deux instants séparés de deux heures appartenaient
    // à deux journées de travail, et un calcul en millisecondes les disait
    // « le même jour ».
    it('sépare deux instants proches qui tombent de part et d’autre de minuit WITA', () => {
      const veille    = businessDateIso('2026-08-03T15:30:00Z'); // 23:30 WITA
      const lendemain = businessDateIso('2026-08-03T17:30:00Z'); // 01:30 WITA
      expect(veille).toBe('2026-08-03');
      expect(lendemain).toBe('2026-08-04');
      expect(veille).not.toBe(lendemain);
    });

    it('accepte une Date comme une chaîne', () => {
      expect(businessDateIso(new Date('2026-08-03T19:47:02Z'))).toBe('2026-08-04');
    });

    it('coïncide avec todayIsoDate pour maintenant', () => {
      expect(businessDateIso(new Date())).toBe(todayIsoDate());
    });
  });
});
