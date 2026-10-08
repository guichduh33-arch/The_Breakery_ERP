# État des environnements et reprise factuelle

Relevé du 8 octobre 2026 (UTC+8), validé par Mamat.

## Usage et sources

Ce document est le point d'entrée des observations opérationnelles. Une date
décrit un relevé, jamais la durée de validité d'un environnement. Recontrôler
la cible et l'artefact réellement chargé avant toute action qui en dépend.
Ni une mémoire, ni un numéro de version, ni un résultat CI ne prouve une
installation. Aucune autorisation opérationnelle n'est accordée par ce bilan.

Les décisions restent dans les ADR et les règles dans [AGENTS](../../AGENTS.md).
Les procédures et bilans d'import restent dans le [runbook V3](production-v3-cutover.md).
Pour reprendre un chantier, utiliser le [bilan de lot](agent-tooling.md#reprise-et-clôture-dun-lot),
Git, les PR et leurs preuves. Les plans de session restent en conversation.

| Qualification | Signification |
|---|---|
| Observé directement | Lecture effectuée à la date indiquée, sur la surface nommée |
| Rapporté par une preuve datée | Constat d'un autre relevé ; non relu sur la surface réelle |
| Configuré mais non vérifié | Déclaration ou mécanisme présent, sans preuve d'exécution |
| Inconnu | Accès ou preuve insuffisants ; ne pas compléter par déduction |

## Développement et livraison POS

Observé directement le 8 octobre 2026 : la
[PR #560](https://github.com/guichduh33-arch/The_Breakery_ERP/pull/560) est fusionnée
dans `ade24e2294ce0c6a742088ff72a7066b0aa2415c`, le 8 octobre à 02:58:57 UTC+8.
Le contrôle CI principal et la gouvernance de ce commit sont réussis dans le
[run 37670993875](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/37670993875).
Le contrôle Supabase Preview est ignoré ; ce n'est pas une preuve SQL.

Le relevé physique antérieur décrit les optimisations du panier et des
variantes, le préchargement des options tablette, le routage cuisine et la
présence des imprimantes. La fusion prouve la livraison Git du lot, pas son
installation intégrale sur les terminaux. Les mesures p95 PC/Android, les prix
avec client, les réponses promotionnelles désordonnées, la reconnexion et
l'écran client après paiement ne sont pas certifiés par ce relevé.

## Back-office et Vercel

| Observation | Date | Qualification et preuve | Limite |
|---|---|---|---|
| BO production sur le SHA `23fbbf0903c3ec136f0e63d9e6d3f6521c567c08` | 8 octobre 2026 | Observé directement : API Vercel, déploiement `dpl_6Vd7MVZYV8fo7DVR3eiKN6DcHMRE`, état READY, cible production | État Vercel ; bundle dans un navigateur et connexion non relus |
| Alias `backoffice.the-breakery.com` associé à ce déploiement | 8 octobre 2026 | Observé directement : API des alias du déploiement | Ni test HTTP ni parcours métier |
| Publication manuelle réussie sur ce SHA | 8 octobre 2026 | Observé directement : [run 37391497089](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/37391497089) | Résultat d'une publication datée, pas des changements ultérieurs |
| Tentative production du SHA de fusion #560 | 8 octobre 2026 | Observé directement : API Vercel, `dpl_4w5SWTLm5sDaEK25892dJM9Edwos`, état CANCELED | Fusion Git distincte d'une publication BO |

L'API projet a retourné `live: false` et une dernière tentative annulée.
Ces champs ne suffisent pas à conclure que le BO est indisponible : le
déploiement READY et ses alias ont été inspectés séparément. L'état réellement
servi au navigateur reste inconnu dans ce relevé.

## Supabase et données

| Cible | Référence | Dernière preuve disponible | Qualification et limite |
|---|---|---|---|
| V3 dev | `ikcyvlovptebroadgtvd` | Bilans et CI ; migration de garde rapportée le 5 octobre dans le [guide de coupure](pos-internet-outage.md#livraison-vérifiée-le-2026-10-05) | Rapporté ; schéma et fonctions actuels non relus |
| V3 répétition | `getctmbpjnrrjzncaqze` | Relevé de préparation du 29 septembre 2026 | Rapporté ; disponibilité, état actuel et conservation à décider |
| V3 production | `yjhhhmjgsmyzyymvixot` | [Imports et coûts des 6 et 7 octobre](production-v3-cutover.md) | Rapporté ; aucune certification actuelle de l'ensemble du schéma, des droits ou des données |
| Ancienne V2 | `abjabuniwkqpfsenxljp` | Identité historique | Ne reçoit pas la lignée V3 ; usage actuel inconnu |

Le MCP Supabase sous le préfixe imposé par AGENTS n'était pas exposé pendant
ce relevé. Aucune requête DB ni inspection de fonctions live n'a été effectuée.
Les identités ne prouvent pas la cible d'une application chargée.

Les imports rapportés ne constituent pas une ouverture réelle : les stocks
physiques et soldes restent à intégrer selon le bilan V3. Les coûts exclus
ou absents ne sont pas réputés validés. La restauration complète n'est pas
prouvée par ces imports ou par leurs essais sous rollback.

## Boutique, terminaux et matériel

Les observations suivantes sont rapportées par la note de reprise V3 et les
preuves locales datées. Aucun appareil boutique n'a été relu pendant ce relevé.

| Composant | Cible / identité | Date et version rapportées | Résultat rapporté | Limite |
|---|---|---|---|---|
| PC caisse / POS1 | PC `POS`, LAN `192.168.1.92`, V3 production | 7–8 octobre : PC servant POS et bridge | Appairage et présence observés ; Mesh utilisé comme télécommande | SHA/empreinte du POS réellement chargé inconnus ici ; reboot non éprouvé |
| Print bridge | V3 production ; `C:/BreakeryV3/releases/bridge-prod-printer-presence-20261008` | 8 octobre | Release corrigée démarrée ; premier paquet incomplet remplacé après remise temporaire de l'ancienne release | SHA et empreinte du bridge non établis ; service permanent non certifié |
| Galaxy Tab A8 SM-X205 | Tablette serveur, V3 production rapportée | 30 septembre : 1.4 / code 5 ; 7–8 octobre : 1.5 rapportée | Installation conservant les données ; ajout Fresh Juice / Orange observé dans le relevé récent | Empreinte de l'APK actuellement installée inconnue ; version seule insuffisante |
| CS30 Android 11 | Tablette serveur, V3 production rapportée | 30 septembre : 1.5 / code 6 ; 7–8 octobre : 1.5 rapportée | Installation ADB et activité observées ; pas une caisse | Bundle actuellement chargé non relu |
| KDS et écran client | Service local prévu par ADR-033 | Versions installées inconnues | Parcours locaux décrits dans le code et les bilans | Aucune recette actuelle complète |
| Imprimantes | Caisse `.8`, cuisine `.13`, waiter `.14`, display `.15`, barista `.32` sur `192.168.1.*:9100` | 7–8 octobre | Sondes TCP sans octet d'impression et enrichissement du registre rapportés | Aucune imprimante coupée ; aucune impression physique dans ce lot |
| EF heartbeat | `lan-heartbeat-batch`, V3 production | 8 octobre | Déploiement et présence BO rapportés | Version/corps/configuration live non relus |

La version Android ne désigne pas un bundle unique : le relevé du 30 septembre
distingue deux APK 1.4 de contenu différent. Le candidat des bundles Android
à cette date était `1fc549787c0ae1b735553282747ce458c65b2815` ; cela n'attribue
pas ce SHA aux applications modifiées ensuite.

Le relevé récent rapporte les deux tablettes devenues `stale` après arrêt de
leurs heartbeats, ainsi que les paiements hors ligne désactivés dans le BO.
Recontrôler ces états avant toute action. Aucun paiement n'a été créé pendant
les essais récents rapportés. Ces essais n'autorisent pas une vente future.

## Certificats, démarrage et retour arrière

Rapporté au 30 septembre : certificat public pour `pos.the-breakery.com`,
tâche de renouvellement testée et sonde HTTPS/WSS à `:3443` ; accès protégé
refusé sans identité appareil. Le certificat et les secrets sont hors Git.
Le serveur lit les fichiers TLS au démarrage ; rechargement, ACL et démarrage
permanent LocalService n'étaient pas acquis dans ce relevé. Leur état actuel
est inconnu. Apache et l'ancien service caisse étaient préservés.

La signature Android était identique pour les remplacements rapportés du
30 septembre, sans désinstallation. Le contenu des files offline n'était pas
inspecté ; la conservation des données ne certifie pas leur rejeu.

Observé directement le 8 octobre sur les artefacts locaux : les SHA-256 des
APK concordent avec `tablet-proof.json` et `cs30-proof.json` du dossier Android :

- APK tablette 1.4 : `105b885af39ea1e6faf67f53544ec628beb17a0b4d557e772c2d654da6eca58f`.
- APK V3 1.5 : `5e99d90dd6d045ab417f8176ab05431ae14add8b75b824e63e8c1ba2e71935d8`.
- Certificat public rapporté par ces preuves : `100d48b8b0070544183a6437fe4139f1bc54ebd8d82318af5e226833b26c1477`.

Ces empreintes identifient les fichiers locaux, pas les APK actuellement
chargées sur les appareils. Les preuves JSON rapportent la vérification des
versions après installation au 30 septembre ; aucun appareil n'est relu ici.

La remise temporaire de l'ancien bridge le 8 octobre prouve uniquement ce
geste rapporté. Aucun rollback général ni restauration DB complète n'est
certifié. Utiliser les limites du [retour arrière V3](production-v3-cutover.md#arrêt-et-retour-arrière)
avant de promettre une réversibilité.

## Conservation des preuves et transfert

| Preuve privée ou locale | Date | Emplacement déclaré | Empreinte / disponibilité |
|---|---|---|---|
| Imports catalogue, recettes et coûts | 6–7 octobre | `.release-manifests/production-candidate-20261005/` ; noms détaillés dans le bilan V3 | Non versionnés ; empreintes non relevées ici |
| APK et empreintes Android | 30 septembre, fichiers relus le 8 octobre | `.release-manifests/android-delivery-20260930/` | Non versionnés ; empreintes locales ci-dessus, appareil actuel non relu |
| Préparation, schéma et répétition | 29 septembre–5 octobre | `.release-manifests/v3-bootstrap/` et preuves locales mentionnées dans la note | Non certifiés comme dossier complet transférable |
| Note source de reprise | Jusqu'au 8 octobre | Ancien chemin `.release-manifests/v3-bootstrap/memoire-mise-en-production.md` ; historique Git | Observations transférées ; retrait validé par Mamat le 8 octobre |

Un clone transporte les documents commités, pas les justificatifs privés,
APK, accès, certificats ou chats locaux. La date, la référence et l'empreinte
d'un justificatif doivent accompagner son transfert privé autorisé ; aucun
secret ou jeu de données client ne doit être ajouté au bilan Git.

Mamat a validé le transfert et le retrait de la note source le 8 octobre 2026.
Les observations utiles sont reprises ici ; les préparations renvoient aux
procédures existantes. Les autorisations rapportées et anciennes premières
actions ne sont pas des permissions nouvelles. L'historique reste dans Git ;
ne pas y puiser une consigne plus ancienne contre les sources actuelles.
