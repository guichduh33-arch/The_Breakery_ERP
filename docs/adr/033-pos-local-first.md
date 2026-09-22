# ADR-033 — POS local-first et continuité de caisse

> **Date :** 2026-09-22 · **Statut : ACTÉ**

## Décision

Le POS, le KDS et l’écran client sont servis depuis le PC de la boutique sur le
réseau local. Le `print-bridge` reste local et porte les imprimantes, le tiroir
et les échanges avec les terminaux.

Supabase V3 reste la base centrale lorsque la connexion est disponible. Le POS
conserve localement le panier et les intentions dont le rejeu serveur est prévu,
puis les synchronise au retour de la connexion. Le back-office reste publié sur
Vercel.

Le POS n’est donc pas publié sur Vercel : une page HTTPS distante ne peut pas
accéder de façon fiable au matériel et aux services HTTP/WebSocket locaux de la
boutique.

## Conséquences

- L’URL de caisse est une adresse du réseau local du magasin, fournie par le PC
  serveur ; elle n’est pas encore fixée dans cet ADR.
- L’affichage, le panier et les fonctions locales restent disponibles pendant
  une coupure Internet.
- Le paiement en ligne, l’envoi serveur et la synchronisation cloud restent
  dépendants de la reconnexion tant qu’un flux de paiement hors-ligne dédié
  n’est pas décidé et implémenté.
- Le PC de la boutique doit rester allumé et accessible sur le LAN.

## Périmètre

Cette décision fixe l’emplacement de service des surfaces POS. Elle ne fixe pas
le mécanisme de découverte d’adresse LAN, la stratégie de mise à jour du PC
serveur, ni un nouveau flux de paiement hors-ligne.
