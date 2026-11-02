# Tickets ouverts, Outstanding et clôtures de caisse

## Parcours opérateur

Un ticket entièrement impayé reste visible dans les tickets ouverts après la clôture de son shift. Sa reprise exige un shift ouvert ; elle transfère le ticket à ce shift et conserve le shift d'origine dans l'audit. Un ticket comportant déjà un paiement ne suit pas ce transfert.

Avec un client sélectionné, le caissier peut choisir **Outstanding**. Le serveur valide le crédit client, finalise les prix, le stock et la vente, puis conserve une créance sans créer de faux paiement. Cette opération exige une connexion.

La page **Outstanding** du POS et la page des commandes Outstanding du backoffice listent les soldes restant dus, sans limite d'ancienneté. Elles acceptent les règlements complets ou partiels en cash, EDC, QRIS et transfert. Après une réponse perdue, vérifier la tentative en attente avant de créer un nouveau règlement.

La vente appartient à sa date de finalisation. Chaque règlement possède sa propre date. Un règlement POS exige le shift ouvert du caissier et entre dans ses encaissements de clôture. Un règlement backoffice ne touche aucun shift ; son cash rejoint la trésorerie hors tiroir POS.

Les remboursements et annulations des tickets Outstanding soldés affectent le shift qui rend effectivement l'argent au POS. Le backoffice conserve les restrictions existantes sur les remboursements cash sans shift. La correction ne crée pas de nouveau parcours d'annulation des créances encore impayées.

L'annulation d'une facture Outstanding est limitée à sa journée de finalisation. Pour une facture d'un jour antérieur, utiliser **Refund**, en sélectionnant toutes les quantités pour un retour complet : la vente reste dans sa période d'origine et le remboursement est enregistré au jour réel du retour.

## Rapport et impression

La clôture conserve un rapport figé puis tente automatiquement son impression sur l'imprimante cashier. Un échec d'impression ne rouvre pas le shift. Vérifier le papier avant une réimpression manuelle ; une tentative sans confirmation peut avoir déjà imprimé. Le bouton du dernier rapport permet sa reprise et marque la réimpression comme duplicata.

Les clôtures déjà enregistrées ne sont pas recalculées lorsqu'une créance est réglée ou remboursée ultérieurement. Les rapports distinguent ventes et encaissements ; ces montants peuvent différer.

## Mise à jour boutique

Le paquet de release réunit le bundle POS et le bridge avec ses dépendances. Sa génération exige le SHA exact de master, les preuves CI et pgTAP et l'environnement Production protégé. Le paquet vérifie explicitement la cible V3 production et ses empreintes avant installation.

Le poste doit disposer d'une configuration locale de mise à jour validée : tâche Windows, lanceur et son empreinte, Node, ancienne release, répertoire des releases, chemins du bridge et du POS, origine HTTPS et chemins persistants. Ce fichier ne contient aucun PIN ni jeton et ne fait pas partie de l'archive publiée. Si la disposition est inconnue, ne pas la deviner.

L'installation conserve la tâche et son compte, les certificats, l'origine HTTPS, l'appairage, le buffer et les données navigateur. Elle prépare une nouvelle release, bascule le lanceur et vérifie les fichiers effectivement servis. En cas d'échec, elle tente de rétablir le lanceur précédent ; vérifier le service après tout retour. Une interruption électrique nécessite de consulter le journal local et la sauvegarde du lanceur avant une nouvelle tentative.

Après installation, recharger le POS et les tablettes et vérifier la version chargée et l'imprimante. La santé HTTP ne prouve ni une sortie papier ni un encaissement réel.

## État de validation daté du 2 novembre 2026

La [PR de livraison](https://github.com/guichduh33-arch/The_Breakery_ERP/pull/628), guide inclus, est fusionnée dans master au commit `ad718421635b2ea750b79fc3c8af7c461d4bf103`. La [CI complète de master](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/41368715855) et les [321 fichiers pgTAP exécutés sur master](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/41368937389) ont réussi. Deux assertions de sécurité préexistantes sont ignorées. La validation d'une archive sur un runner Windows a également réussi ; elle inclut le démarrage HTTPS du bridge empaqueté et les fichiers POS servis.

Le backend est installé en production : paquet de migrations compatible enregistré et fonctions serveur d'annulation/remboursement déployées, actives et relues. Une vérification indépendante en lecture seule confirme les nouveaux contrats, la conservation des anciens contrats, le rattachement correct des paiements ordinaires et le maintien des imports protégés hors shift. Le mapping cash existant est conservé. Aucun paiement ni mouvement métier de test n'a été créé en production.

La [publication protégée du backoffice](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/41372674448) a réussi. Vercel confirme le commit attendu en production sur `backoffice.the-breakery.com` ; la route Outstanding et le bundle principal répondent en HTTP 200. Ce contrôle HTTP ne remplace pas une recette authentifiée dans le navigateur.

Le [workflow protégé du paquet POS + bridge](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/41372719816) a réussi. L'[archive installable](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/41372719816/artifacts/13110197500) contient le bundle et le bridge pour le commit testé, avec leurs empreintes. La vérification des fichiers réextraits et le démarrage HTTPS ont réussi sur Windows.

### Installation réelle sur la caisse

Le 2 novembre 2026 à 03:29:53 UTC, l'installation sur le poste de caisse a terminé avec l'état `verified` pour le SHA `ad718421635b2ea750b79fc3c8af7c461d4bf103`, cible V3 production `yjhhhmjgsmyzyymvixot`. Le paquet a été vérifié puis installé à côté de l'ancienne release. Une adaptation locale, explicitement autorisée, conserve le bootstrap existant comme point d'entrée et utilise Node portable 22.23.4 ; le Node global reste intact.

L'adaptation vérifie que la tâche `Breakery V3 Production` conserve son compte Cashier, ses déclencheurs, ses arguments, son répertoire et ses paramètres hors exécutable Node. La configuration externe, les certificats et les droits du lanceur ont été vérifiés inchangés. Les chemins persistants d'appairage et de buffer sont conservés ; leur contenu peut évoluer pendant le fonctionnement. Aucune purge des données navigateur n'a été effectuée ; la conservation observée concerne le panier existant.

Le processus du bridge et tous les fichiers POS servis ont été vérifiés sur les deux origines HTTPS, ports 3001 et 443. Après rechargement, l'inspecteur de la caisse montre le bundle attendu `index-fo_OHcGb.js`. Le panier existant de deux articles, total Rp110 000, est resté présent, sans encaissement ni clôture. L'écran client a été rechargé puis reconnecté au même panier. Le terminal POS1 conserve son appairage ; le test de connexion répond « Reachable ». Un ticket TEST a été déclenché depuis les paramètres avec une session manager, puis Mamat a confirmé sa sortie papier lisible sur l'imprimante cashier.

Le panneau de diagnostic Hub reçoit un HTTP 403 ; ce constat reste distinct de l'impression réussie. Aucune permission appareil n'a été élargie pour le contourner. Le redémarrage complet de Windows et le retour arrière n'ont pas été exécutés pendant cette installation réussie.

### Recette restante et preuves

Deux tests SQL transactionnels du SHA livré ont réussi sur V3 DEV : 28 assertions de reprise cross-shift et 14 de reporting, sans échec ni assertion ignorée ; les fixtures ont été retirées par rollback. Le test SQL de règlement Outstanding n'a pas été exécuté : son transport par fichier vers l'API de gestion n'était pas disponible. Le bundle DEV servi a été identifié et sa cible vérifiée, avec impression simulée. La recette financière authentifiée dans le navigateur reste à effectuer, faute de compte de test disponible. Aucun faux paiement ou mouvement métier n'a été créé en production.

Les tablettes utilisent une application Android avec bundle embarqué. Aucun APK production du SHA livré n'était disponible dans les artefacts vérifiés : un APK release 1.14/code 15 a donc été fabriqué à partir de la coquille du SHA livré et des fichiers web du paquet production, sans reconstruire le web. Seules les métadonnées natives de version changent. Les 89 ressources web embarquées sont conformes au manifeste ; le manifeste Vite de fabrication est exclu par Android et deux fichiers Cordova sont générés. Le certificat de signature, la configuration Capacitor et la politique réseau sont identiques à ceux de l'APK Samsung sauvegardé.

La Samsung SM-X205 et la CS30 ont été mises à jour en remplacement par USB, sans désinstallation ni purge. Les APK relues depuis les appareils sont identiques au paquet validé, SHA-256 `f3bd0a5547468dbf95603920fa26fe09080946b4c4afb642416f869eb4d5be6b` ; Android rapporte 1.14/code 15 et conserve leurs dates de première installation. Leurs sessions authentifiées et plans de salle « ONLINE » sont observés, après saisie personnelle du PIN par Mamat lorsque nécessaire. Les historiques d'impression sont conservés. La Samsung présente trois entrées « Print to verify — Failed to fetch » ; aucune réimpression de ces tickets n'a été déclenchée et ces entrées ne prouvent pas un nouvel échec après mise à jour. L'envoi d'une nouvelle commande et l'impression depuis les tablettes restent non testés. La [procédure Android](tablet-capacitor-build.md) précise la conservation de signature et de données lors du remplacement.

Les preuves privées de cette intervention sont conservées sous `.release-manifests/shop-update-20261102/`, notamment `installation-cashier-result.json`, `installation-release-journal.json`, `cashier-browser-observed.json`, les scripts d'adaptation dans `adaptation/`, `tablet-package-verified.json`, `tablet-samsung-installation.json`, `tablet-cs30-installation.json`, `dev-browser-observed.json` et `dev-acceptance/acceptance-summary.json`. Elles ne sont pas transportées par un clone Git et ne contiennent dans ce bilan aucun PIN, jeton ni clé privée. Une note manuelle de reprise a été enregistrée après accord explicite de Mamat ; la consolidation automatique de mémoire du client n'est pas certifiée.
