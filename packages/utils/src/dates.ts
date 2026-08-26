// packages/utils/src/dates.ts
import { formatInTimeZone } from 'date-fns-tz';

// ADR-019 (D5) — CONSTANTE CLIENT UNIQUE du fuseau métier. C'est la seule
// déclaration littérale côté client : `@breakery/domain` la réexporte sous le
// nom DEFAULT_TIMEZONE, les applications l'importent, personne ne la redéclare.
//
// Le client ne lit PAS business_config pour cela (D5) : cette colonne est un
// miroir, et l'autorité réelle est le paramètre de session PostgreSQL, que le
// client ne voit pas. Changer le fuseau est un geste de déploiement — cette
// ligne, la colonne miroir et le paramètre de session bougent dans le même lot.
export const TIMEZONE = 'Asia/Makassar';

export function formatDateTimeWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

// Le format de lecture des tables du Backoffice : « 04 Aug 2026, 14:30 ».
// Le mois en lettres retire l'ambiguïté jour/mois d'un `toLocaleString()`
// laissé au navigateur (qui rendait 8/3/2026 pour le 3 août), et les secondes
// sautent — une liste se lit, elle ne s'horodate pas. Pour un horodatage
// exact (audit, export), c'est formatDateTimeWita qu'il faut.
export function formatDateTimeShortWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'dd MMM yyyy, HH:mm');
}

// Audit UX/UI 2026-08-13 (lot 5) — `formatDate` : date seule, jj/MM/aaaa
// (l'audit a relevé du 06/14/2026 US via des toLocaleDateString() sans locale).
// `formatDateTime` : le format de table existant (dd MMM yyyy, HH:mm) sous son
// nom générique — même fuseau ADR-019.
//
// ⚠️ CES DEUX-LÀ ONT LONGTEMPS ÉTÉ APPELÉES « les deux formats canoniques de
// l'app ». Le fichier en exporte SEPT depuis, et la phrase faisait croire à un
// lecteur pressé que les autres étaient des accidents à supprimer. Elles
// ne le sont pas : ce sont SEPT RÔLES distincts, et le rôle est ce qui autorise
// la forme. Récapitulatif tenu à jour ici, et nulle part ailleurs :
//
//   formatDateTimeWita       yyyy-MM-dd HH:mm:ss   horodatage exact (audit, export)
//   formatDateTimeShortWita  dd MMM yyyy, HH:mm    ligne de table  (= formatDateTime)
//   formatDate               dd/MM/yyyy            date seule, saisie et filtre
//   formatTimeWita           HH:mm                 heure seule, dans un jour déjà nommé
//   formatDateShortWita      dd MMM                seconde ligne d'une cellule
//   formatDateLong           MMMM d, yyyy          titre de page
//   formatMonthYearWita      MMMM yyyy             nom d'un MOIS entier (période fiscale)
//
// Une HUITIÈME forme rendue à l'écran est une forme de trop : elle vient d'un
// `toLocaleDateString()` oublié quelque part, et sa place est ici.
export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'dd/MM/yyyy');
}

export function formatDateTime(d: Date | string): string {
  return formatDateTimeShortWita(d);
}

export function formatTimeWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'HH:mm');
}

// Le jour seul, court, pour la seconde ligne d'une cellule de liste
// (« 12 Aug ») — même discipline anti-ambiguïté que le format de table.
export function formatDateShortWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'dd MMM');
}

// Le titre long, pour un en-tête de page (« August 21, 2026 »).
//
// Il posait `format` au lieu de `formatInTimeZone` — LE SEUL du fichier à
// échapper au fuseau métier, dans un fichier qui n'existe que pour l'imposer
// (ADR-019). Conséquence sur le seul appelant, le titre du Dashboard : entre
// minuit et 08 h WITA, le navigateur du lecteur étant en UTC ou plus à
// l'ouest, la page annonçait la VEILLE en gros au-dessus de chiffres du jour.
// Corrigé le 2026-08-21.
export function formatDateLong(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'MMMM d, yyyy');
}

// Le nom d'un MOIS entier (« December 2027 ») — pour un objet dont l'unité EST
// le mois : une période fiscale, jamais un instant. La page des périodes
// rendait `2027-12-01 → 2027-12-31` au moment le plus lourd de conséquences de
// l'application (critique design 2026-08-26) ; un mois se nomme, il ne se
// borne pas.
export function formatMonthYearWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'MMMM yyyy');
}

export function todayIsoDate(): string {
  return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

// Le PREMIER JOUR du mois métier courant — la borne basse par défaut de toutes
// les périodes du module comptable (journal, balance, grand livre, coffres) et
// du hub qui les précharge.
//
// LE DÉFAUT QU'IL FERME. Ces écrans écrivaient chacun leur copie de
// `new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)` : le
// `Date` était construit dans le fuseau du NAVIGATEUR, puis `toISOString` le
// reconvertissait en UTC. Sur un poste réglé à l'heure de Bali (UTC+8), minuit
// du 1ᵉʳ août redevient le 31 juillet 16:00, et la chaîne sortait
// « 2026-07-31 » — un jour ET un mois trop tôt. Le même calcul sur
// « aujourd'hui » (`new Date().toISOString()`) rendait la VEILLE entre minuit et
// 08 h WITA — les heures de fermeture de caisse, précisément celles où un
// comptable ouvre ces écrans. Même famille que le bug de `formatDateLong`
// corrigé le 2026-08-21, et même remède : passer par le fuseau métier.
//
// On compose `yyyy-MM` + `-01` plutôt que de formater un `Date` construit au
// premier du mois : la construction locale ramènerait le fuseau du navigateur
// dans le calcul, qui est exactement ce dont on sort.
export function monthStartIsoDate(): string {
  return `${formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM')}-01`;
}

// Le JOUR MÉTIER d'un instant quelconque — pendant de `todayIsoDate` pour une
// date qui n'est pas maintenant. Sert à comparer deux dates en jours de
// calendrier plutôt qu'en tranches de 24 h : un mouvement d'hier 23 h et un
// d'aujourd'hui 1 h sont à deux heures l'un de l'autre mais appartiennent à
// deux journées de travail différentes, et c'est la journée qui se lit.
export function businessDateIso(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd');
}
