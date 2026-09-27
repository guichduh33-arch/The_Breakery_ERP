# ADR-034 — Autorisation individuelle et chiffrement du LAN

> Statut : projet, texte à valider avant commit.
> Date : 2026-09-27.
> Décision fonctionnelle et plan d’implémentation validés par Mamat en conversation.

Le hub reste sur le PC du magasin, dans le print-bridge. Les terminaux restent servis localement. Le back-office gère les autorisations via Supabase, sans connexion directe au LAN.

Les échanges réseau avec le hub utilisent HTTPS/WSS. Cette décision remplace uniquement le transport LAN en clair décrit par ADR-030 et précisé par ADR-033 ; elle ne déplace aucune application vers un hébergement distant et n’ouvre pas la CSP du back-office.

Chaque appareil possède une autorisation révocable et des capacités propres. Un responsable disposant de lan.devices.manage émet un code à usage unique depuis le back-office. Les secrets restent séparés du registre public des appareils. Aucun appareil n’hérite des droits d’un employé.

Les appareils déjà autorisés continuent de travailler avec le dernier registre valide pendant une coupure Internet. Un changement distant devient effectif à la synchronisation suivante. Un administrateur du PC peut bloquer localement un appareil ; ce blocage survit aux synchronisations et au redémarrage. Le comportement des paiements hors ligne défini par ADR-015 reste inchangé.

La présence ne peut jamais réactiver un appareil désactivé. Les commandes matérielles, événements et reprises d’historique sont contrôlés par le hub. Le tiroir est réservé aux appareils explicitement autorisés.

La mise en production nécessite un certificat accepté par les terminaux, un compte de service et des ACL système protégeant les fichiers du hub, ainsi qu’une mise à jour coordonnée des terminaux. Une panne de configuration refuse les opérations protégées ; elle ne rétablit pas le protocole anonyme.

La spécification temporaire d’exécution est 006x-lan-device-security, exigée par ADR-006. Aucun déploiement production ni installation boutique n’est autorisé par ce texte.
