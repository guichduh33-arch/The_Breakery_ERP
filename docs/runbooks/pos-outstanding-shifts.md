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

La recette dans un navigateur connecté, l'installation sur le poste de caisse et la sortie papier restent à effectuer. Une adresse MeshCentral a été fournie, mais aucun outil de contrôle Chrome n'est disponible dans cette session. Un essai sur runner Windows ne prouve pas l'installation sur le poste ni la sortie papier. Aucun mécanisme existant de mise à jour automatique n'a été établi. La mémoire native du client n'est pas vérifiable depuis cette session.
