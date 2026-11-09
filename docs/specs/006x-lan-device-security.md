# Sécurité des appareils LAN — spécification d’exécution

Cette spécification met en œuvre le plan validé par Mamat le 27 septembre 2026 et le projet ADR-034. Elle complète le chantier hub exigé par ADR-006, sans modifier les ADR existants. Elle sera retirée à la livraison conformément aux règles documentaires.

## Autorité et données

Le registre lan_devices reste la source des identités, de l’état actif et des imprimantes. La table lan_device_credentials, protégée par RLS et sans accès client, contient les empreintes, dates d’appairage/révocation et capacités. Les codes sont aléatoires, expirent après dix minutes et ne peuvent servir à un autre secret. Le retry avec le même secret est accepté pour récupérer une réponse perdue.

La gestion utilise une session opaque employé vérifiée puis recontrôle lan.devices.manage dans la RPC. Les écritures d’audit sont effectuées par les RPC avec user_profiles.id. Aucun secret brut ne figure dans les journaux.

L’API lan-device-access accepte les actions list, issue, permissions, revoke, pair et heartbeat. Les deux dernières utilisent x-lan-secret et, pour pair, x-lan-pairing-code. Le client génère le secret aléatoire, le conserve pour les retries et le stocke localement après activation. Les RPC serveur ne reçoivent que des empreintes.

Le heartbeat agrégé retourne aussi le registre privé du hub. Il utilise exclusivement x-hub-secret et ne délivre aucune clé privilégiée Supabase. La présence individuelle est résolue après vérification du secret, jamais à partir d’un code libre.

## Hub

Le serveur démarre uniquement avec certificat, clé TLS et origines autorisées. Les routes HTTP protégées utilisent x-lan-device-code et x-lan-secret. Le WebSocket authentifie son premier message, vérifie chaque publication et filtre réception/rattrapage. Les noms et types déclarés ne donnent aucun droit.

Les capacités couvrent commandes, cuisine, paiements, impressions, tiroir et diagnostics. Les profils par défaut suivent le plan validé. Les topics sans producteur actuel ni contrat pris en charge restent refusés ; aucune habilitation générique ne permet d’injecter un événement.

Le registre est téléchargé toutes les dix secondes, même sans appareil connecté. Sa validation précède une écriture atomique. Le cache est lié à l’URL cloud ; un cache invalide ou absent n’autorise rien. Les listes de blocage local sont séparées et ne sont jamais écrasées par la synchronisation.

La commande locale block-device exige l’élévation administrateur. Elle accepte block ou unblock et un identifiant d’appareil. Le hub relit le blocage à chaque opération et ferme les connexions invalidées sous un quart de seconde hors délai du système.

## Paramètres de futur déploiement

HUB_TLS_CERT et HUB_TLS_KEY désignent les fichiers du certificat accepté par les terminaux. HUB_ALLOWED_ORIGINS contient les origines exactes autorisées, séparées par virgules. HUB_REGISTRY_FILE désigne le cache privé ; son fichier compagnon .blocked porte les blocages locaux. HUB_CLOUD_URL reste l’URL HTTPS de lan-heartbeat-batch ; HUB_CLOUD_SECRET correspond au secret serveur configuré dans Supabase.

Le dossier d’état et la clé TLS doivent être protégés par ACL Windows : écriture réservée aux administrateurs et au compte du service, aucun droit aux utilisateurs ordinaires. Cette installation est un prérequis boutique distinct ; elle n’est pas effectuée depuis cette session.

Le poste utilise l’URL HTTPS locale du hub. L’ancien code partagé et les accès anonymes disparaissent. Les terminaux doivent être réappairés après leur mise à jour. Aucun retour au protocole non authentifié n’est prévu. Les formats des intentions de ventes en attente restent inchangés.

## Validation et limites

Tests SQL transactionnels sur la répétition, tests unitaires API, tests HTTP/WebSocket, scénario HTTPS avec matériel simulé, continuité après redémarrage, révocation distante et blocage local. Suite back-office complète, tests POS concernés, types et lint. Suite POS complète en CI lors d’une future PR autorisée.

Le déploiement serveur vise dev après validation de la répétition. Aucun compte production, import métier, installation physique ou bascule n’est inclus. Les preuves doivent distinguer les tests automatisés des essais matériels encore à réaliser.
