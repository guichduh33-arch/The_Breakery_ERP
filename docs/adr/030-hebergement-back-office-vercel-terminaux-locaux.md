# ADR-030 — Hébergement : back-office publié sur Vercel, terminaux de vente servis en local

> **Date :** 2026-08-22 · **Statut : ACTÉ** (décision propriétaire 2026-08-22, en réponse à la
> question d'hébergement posée le même jour ; commit du texte après validation)

## Décision

Le **back-office** est publié sur **Vercel**, en HTTPS, joignable depuis internet.

Le **POS**, le **KDS** et l'**écran client** restent servis depuis le **PC de la boutique**, en
clair sur le réseau local. La tablette de salle suit sa propre voie, déjà tranchée par
l'ADR-029 : coquille Capacitor autour du même bundle web.

La base **Supabase cloud** reste le point de rendez-vous unique. Aucune liaison directe entre
le back-office et le POS n'est créée : ils ne se parlent pas, ils parlent tous les deux à la
base, et le realtime propage. Cette décision ne change rien à ce schéma — elle décide
seulement **d'où chaque page est servie**.

## Contexte

Constats vérifiés dans le dépôt le 2026-08-22 :

- **Rien n'est déployé aujourd'hui.** `vercel.json` ne porte que des en-têtes de sécurité et
  une CSP ; il n'existe aucun dossier `.vercel` ; dans
  `.github/workflows/staging-deploy.yml`, les deux étapes de déploiement Vercel sont
  désarmées par un `if: false`. Les deux applications ne tournent qu'en développement local.
  La base, elle, est déjà dans le cloud.
- **Le back-office et le POS ne communiquent pas entre eux.** Il n'existe ni appel de l'un
  vers l'autre, ni adressage mutuel. Le seul canal est la base.
- **Il existe une seule liaison réseau local : le `print-bridge`.** Il porte les imprimantes
  (reçus, tickets de station, tiroir) et le bus du hub, qui garde la cuisine vivante quand
  internet tombe. Le POS l'appelle ; le back-office l'appelle aussi, depuis sa page LAN
  Devices, dont l'adresse de bridge est saisie à la main côté terminal.
- **L'empêchement est la règle du contenu mixte** — la même qui a fondé l'ADR-029. Une page
  servie en `https://` ne peut pas appeler un `http://` ni un `ws://` vers une adresse locale.
  Le navigateur refuse, et cela ne se contourne pas côté page. Un back-office publié perd donc
  mécaniquement ses gestes réseau local.
- La CSP déjà écrite dans `vercel.json` énumère `'self'`, Supabase et Sentry en `connect-src`.
  Elle interdit donc **déjà** au back-office publié de joindre le bridge, indépendamment de la
  règle du contenu mixte. Les deux verrous disent la même chose.

Le besoin qui justifie la publication est simple : consulter les ventes, les rapports et la
comptabilité **hors de la boutique**. Ce besoin ne concerne que le back-office. Les terminaux
qui encaissent, eux, ont un besoin contraire : continuer à fonctionner quand la ligne tombe.

## Arbitrages (propriétaire, 2026-08-22)

1. **Vercel pour le back-office, et lui seul.**
2. **Les terminaux qui encaissent restent servis en local.** L'encaissement et l'envoi en
   cuisine ne dépendent pas d'internet.
3. **Aucune ouverture de la CSP** pour laisser le back-office publié atteindre le réseau
   local — ni élargissement de `connect-src`, ni tunnel, ni certificat local. L'écart est
   assumé, pas contourné.
4. **Les gestes réseau local du back-office déménagent vers le POS**, ils ne sont pas
   dupliqués des deux côtés.

## Conséquences

1. **La page LAN Devices du back-office se scinde.** Sa partie cloud — la liste des appareils,
   alimentée par le heartbeat agrégé que le hub pousse vers l'Edge Function — survit en HTTPS
   et reste consultable à distance. Ses gestes qui touchent le bridge — balayage du réseau,
   sonde d'imprimante, ticket de test, état du hub — cessent d'y fonctionner et rejoignent
   l'onglet Devices des réglages du POS, qui porte déjà la sonde, le reçu de test, le tiroir
   et le jeton du hub.
2. **Le dépôt gagne une cible de déploiement continue qu'il n'a pas.** Projet Vercel,
   variables d'environnement, et accord entre la CSP publiée et les origines réellement
   appelées. La chaîne d'intégration actuelle ne couvre pas ce déploiement.
3. **Le PC de la boutique devient un serveur.** Il ne fait plus seulement tourner le bridge :
   il sert aussi le bundle des terminaux. S'il est éteint, il n'y a pas de caisse. Cette
   dépendance doit être écrite dans un runbook d'exploitation.
4. **Les deux surfaces ne se mettent plus à jour de la même façon.** Le back-office se met à
   jour par publication ; les terminaux se mettent à jour sur le PC de la boutique. Une même
   version du dépôt peut donc être vivante d'un côté et pas de l'autre.
5. Côté Edge Functions, rien à ajuster : la politique CORS partagée accepte déjà toute
   origine. Le seul verrou d'origine est la CSP servie avec le back-office.

## Ce que cette décision ne tranche pas

Ces points restent à arbitrer, et ne sont pas présumés ici :

- le nom de domaine du back-office, et s'il porte une protection d'accès supplémentaire ;
- **comment** le bundle des terminaux est servi sur le PC de la boutique — service statique
  dédié, ou le bridge lui-même qui sert aussi les fichiers ;
- la stratégie de mise à jour des postes de la boutique ;
- si le KDS et l'écran client restent web ou suivent la voie Capacitor — l'ADR-029 laissait
  déjà cette question ouverte, cette décision ne la ferme pas ;
- le plan de bascule : quand, dans quel ordre, et avec quel retour arrière ;
- ce qu'il advient de la page LAN Devices pendant l'intervalle où ses gestes ont quitté le
  back-office sans être encore arrivés dans le POS.
