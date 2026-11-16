# Outils de contexte : rôle, preuves et limites

Relevé du 8 octobre 2026 (UTC+8), validé par Mamat.

## Sources durables

Les règles, décisions et bilans restent dans Git suivant
[AGENTS](../../AGENTS.md). Les outils ci-dessous facilitent la navigation ou
la gestion de contexte ; ils ne certifient ni une décision, ni un test,
ni une installation. Reprendre via les [consignes agents](agent-tooling.md)
et l'[état des environnements](etat-environnements.md).

## Headroom : proxy distinct du MCP

| Mécanisme | Fonction et observation | Limite |
|---|---|---|
| Proxy | La configuration globale Codex observée dirige les requêtes vers `127.0.0.1:8787/v1` ; logs et statistiques répondent | Dépendance locale ; non provisionnée par le dépôt |
| MCP | Compression à la demande et récupération d'un original par son hash | Déclaration différente du proxy ; disponibilité dépend du client et du runtime |
| Cache CCR | Base SQLite locale observée dans le profil utilisateur Headroom | Contenu temporaire ; pas une mémoire des décisions Breakery |
| Watchdog | Script local contrôlant `/livez` puis prévoyant le lancement du proxy | Présence du script ; exécution et redémarrage effectif non certifiés |
| Self-heal | Le code installé traite une URL de proxy morte dans les réglages locaux Claude | Ne restaure pas un chantier Codex ; hook projet retiré pour ce rôle inapplicable |

La configuration projet MCP fixe `headroom-ai[mcp]==0.37.0` et utilise
`uvx` directement, sans shell Windows. Le runtime doit déjà être disponible
dans le PATH du client ; une déclaration ne prouve pas son démarrage.
Aucune installation ni modification des réglages globaux n'a été effectuée
pendant cette correction. La configuration globale du proxy reste propre au
poste et doit être vérifiée séparément sur une nouvelle machine.

## Vérifications synthétiques du 8 octobre

- L'outil MCP exposé a compressé puis restitué exactement un original
  synthétique de 9 532 caractères, sans donnée projet ou personnelle.
- Le lanceur Headroom existant a annoncé la version 0.37.0. Son serveur MCP
  lancé en stdio a restitué exactement un autre original de 5 331 caractères.
  L'identité de serveur annoncée `headroom` / `1.30.0` ne remplace pas la
  version du paquet, vérifiée séparément.
- Les essais directs ont rencontré la résolution du runtime uv bloquée dans
  le sandbox Windows ; le même lanceur existant et le test stdio ont réussi
  hors sandbox, sans installation. Des diagnostics stderr étaient présents.
- Deux récupérations antérieures de grandes sorties avaient retourné un
  marqueur dans l'original, sans expansion du texte. Les succès synthétiques
  ne ferment pas cette limite ni ne prouvent la fidélité de toutes les sorties.

Dans le code installé de cette version, la compression MCP à la demande
applique un TTL explicite de 3 600 secondes. Le store CCR général a un défaut
de 1 800 secondes, surchargeable par environnement. Le TTL effectif du proxy,
l'expiration réelle et la survie après redémarrage n'ont pas été éprouvés ici.
Les pourcentages de statistiques ne prouvent pas la fidélité d'un contenu.

## Codex : hooks et mémoire

Le CLI installé annonce `codex-cli 0.160.0` et la feature `hooks` stable active.
Cela prouve le support déclaré du binaire, pas le déclenchement de chaque
événement dans le client desktop. La composition effective des hooks globaux
et projet n'a pas été tracée de bout en bout.

Les hooks projet `PostToolUse` et `Stop` restent des contrôles Impeccable.
Ils ne chargent pas les bilans et n'écrivent aucune mémoire métier. Leur
lanceur peut chercher un moteur ; ne pas les exécuter pour une simple lecture
en supposant qu'ils sont sans effet. La configuration globale est distincte.

L'historique des chats a pu être retrouvé par les outils du client. Un ancien
bilan peut être dépassé : revalider Git et les résultats distants. L'activation,
l'écriture utile et la portabilité de la mémoire native ne sont pas prouvées
par l'existence d'une base locale. Aucun accès interne ne confirme une
mémorisation native dans ce lot.

## Serena et Ruflo

Serena est déclarée mais désactivée dans la configuration globale Codex
observée. Le projet déclare des serveurs de langage vides et son dossier de
mémoires est vide. Un démarrage historique ne certifie pas l'indexation actuelle.
Son rôle éventuel est la navigation du code, sans autorité sur les décisions.

Ruflo reste déclaré dans `.mcp.json`, démarrage automatique désactivé,
backend `hybrid`. Des références existent également dans les réglages globaux
Claude : le désusage n'est pas établi. Aucun outil Ruflo n'était exposé et
aucun stockage runtime n'a été trouvé à la racine. Stockage ailleurs, lecteurs,
écrivains, persistance et partage sont inconnus ; ne pas déduire leur sens
du seul mot `hybrid`. Aucun retrait ni suppression de données n'a été effectué.

Mem0 n'est pas ajouté : aucun besoin exclusif n'est démontré. Les fichiers
de contexte généré restent des inventaires, pas des bilans persistants.
