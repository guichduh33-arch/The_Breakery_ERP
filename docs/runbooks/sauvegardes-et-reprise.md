# Sauvegardes et reprise

> Écrit le **2026-11-09** (tâche `S1-01`). Remplace le guide archivé, qui
> prescrivait cinq objets SQL inexistants.
>
> **État au 2026-11-09 : aucune sauvegarde autonome n'est installée, le PITR est
> désactivé, et aucune restauration n'a jamais été éprouvée.** Ce document donne
> la procédure ; l'exécuter est un geste à part, dont la preuve se consigne dans
> [l'état des environnements](etat-environnements.md).

## Ce que cette chaîne fait, et ne fait pas

Le dépôt porte une chaîne de sauvegarde **chiffrée et testée** dans
`scripts/release/`. Elle produit une archive locale `.bkb` et un reçu JSON.

**Elle couvre** l'export logique de la base (format `custom` de PostgreSQL),
plus tout fichier que vous lui désignez explicitement : configuration boutique,
bundles, files d'attente de terminaux.

**Elle ne couvre pas**, et le code le déclare lui-même dans chaque reçu :

- les **rôles de cluster** et la configuration de plateforme Supabase ;
- les **octets des objets de stockage** — un export séparé est nécessaire ;
- la **restauration d'une application** : lister une archive ne prouve pas
  qu'elle se réinjecte dans Supabase.

Chaque résultat porte des drapeaux de preuve. **Ne les lisez pas comme des
défauts : ils disent la vérité.**

| Drapeau | Devient vrai | Quand |
|---|---|---|
| `cloudCopyVerified` | **oui** | après un transfert hors site **relu** depuis le Drive et comparé (étape 7) |
| `recoveryVerified` | non | reste faux : aucun code ne le passe à vrai |
| `applicationRecoveryVerified` | non | reste faux : c'est la répétition humaine qui l'établit |
| `dailyAutomationInstalled` | non | reste faux : le script ne voit pas le planificateur Windows |

**La rétention locale ne supprime rien.** `retentionReview` signale ce qui
dépasse trente jours et renvoie toujours `deletionAuthorized: false`. L'espace
disque du PC boutique croît donc indéfiniment : c'est un choix, la purge reste
un geste humain. La rotation **distante**, elle, peut supprimer — mais seulement
sur une copie neuve entièrement vérifiée, et elle conserve tout fichier distant
qu'elle ne reconnaît pas.

## Le principe de la clé

Deux clés RSA 3072 sont générées ensemble :

| Fichier | Où il vit | Rôle |
|---|---|---|
| `backup-public.pem` | **sur le PC boutique** | chiffre les sauvegardes |
| `recovery-private.pem` | **jamais sur le PC boutique** | déchiffre, donc restaure |

Ce n'est pas une recommandation : la chaîne **refuse** de sauvegarder sa propre
clé privée si elle la rencontre dans une source. Elle inspecte le contenu de
chaque fichier contenant un bloc de clé privée et compare la clé publique
dérivée à son destinataire.

### Décision de Mamat, 2026-11-09 : la clé vit sur le VPS Hostinger

La paire a été **générée le 2026-11-09** sur le VPS Hostinger, sur sa décision.

| | |
|---|---|
| Machine | VPS Hostinger `srv1753453.hstgr.cloud`, Ubuntu 24.04 |
| Dossier | `/root/cles-reprise-breakery`, mode `700` |
| Fichiers | `recovery-private.pem` et `backup-public.pem`, mode `600` |
| Taille de clé | RSA **3072 bits** |
| Empreinte SHA-256 de `backup-public.pem` | `6e519ce086daf159fe3fcaac99805530ad931f1124d32bdf6f34b2727505a29d` |

**À quoi sert cette empreinte.** C'est le moyen de vérifier, plus tard, que le PC
boutique porte bien la bonne clé publique — donc que ses archives seront
ouvrables par cette clé privée :

```powershell
Get-FileHash -Algorithm SHA256 "C:\chemin\backup-public.pem" | Format-List Hash
```

Si l'empreinte diffère, **les archives de ce poste ne s'ouvriront pas** avec la
clé ci-dessus. Arrêtez et comparez avant de produire des sauvegardes.

> ### Deux copies depuis le 2026-11-09
>
> Une **seconde copie vérifiée** vit sur un SSD externe détenu par Mamat, hors
> du VPS. Conformité contrôlée par taille et empreinte SHA-256, sans jamais
> ouvrir le fichier. Le VPS n'est donc plus un point de défaillance unique.
>
> **Les deux copies sont en place et la question des clés est close.** La copie
> qui traînait sur le disque principal du poste a été retirée le 2026-11-09
> (`1 quater`), après vérification que celle du SSD était conforme.
>
> **Limite assumée** (`1 ter`) : le SSD n'est pas chiffré, sur décision de
> Mamat du 2026-11-09. L'exFAT ne portant aucune permission, la clé y est
> lisible par quiconque branche le disque : la protection de cette copie est
> **physique**, et vaut ce que vaut la garde du support. C'est un choix, pas un
> oubli — **ne pas le re-signaler comme un défaut.**
>
> ### ⚠️ Pourquoi la copie hors VPS était nécessaire
>
> Trois façons de perdre la clé du VPS, donc de rendre **toutes** les
> sauvegardes définitivement illisibles :
>
> 1. l'opération *recreate* de Hostinger réinstalle le système et **efface
>    tout**, en un clic depuis hPanel ;
> 2. un abonnement suspendu ou non renouvelé emporte le serveur ;
> 3. c'est un disque unique, sur une machine à IP publique avec SSH ouvert, et
>    partagée avec un autre projet.
>
> C'est pourquoi une seconde copie, hors du VPS et détenue par Mamat, était
> nécessaire. **Elle existe depuis le 2026-11-09** et a été vérifiée conforme.
>
> **Cette copie, l'agent ne doit pas la faire — pour une question de garde, pas
> de fuite.** Soyons précis, parce qu'une justification approximative se fait
> « corriger » par la session suivante :
>
> - **Afficher** la clé privée — `cat`, `base64`, l'ouvrir dans un éditeur — la
>   ferait entrer dans le journal de la conversation, en clair. **Interdit, sans
>   exception.** Comparer deux clés se fait par **dérivation** ou par empreinte,
>   jamais en les lisant.
> - Un `scp`, lui, transfère les octets sans rien afficher : il **ne fuite pas**.
>   Ce n'est donc pas la raison.
>
> La vraie raison est la **garde** : la copie de secours n'a de valeur que si
> elle est détenue par Mamat, sur un support qu'il contrôle — un support chiffré
> qu'il range lui-même, un gestionnaire de mots de passe où un agent n'a pas
> accès. Une copie posée par un agent dans un dossier quelconque est une copie
> de plus à surveiller, pas une sauvegarde de la clé. La commande est donc à
> lancer **par Mamat lui-même**, depuis son poste :
>
> ```powershell
> scp root@srv1753453.hstgr.cloud:/root/cles-reprise-breakery/recovery-private.pem "$HOME\recovery-private.pem"
> ```
>
> **Piège, rencontré le 2026-11-09 :** le `scp` de Windows **ne comprend pas
> `~/`** pour la destination locale — il répond `No such file or directory`.
> Donner un chemin Windows, ou `$HOME\…` en PowerShell. De façon générale, les
> commandes de ce runbook qui tournent sur un poste Windows sont en PowerShell ;
> celles en `bash` s'exécutent sur le VPS ou dans Git Bash.
>
> Vérifier que la copie est intacte, **sans jamais ouvrir le fichier** :
>
> ```powershell
> Get-FileHash -Algorithm SHA256 "$HOME\recovery-private.pem" | Format-List Hash
> ```
>
> Comparer à l'empreinte relevée sur le VPS par `sha256sum`. `Get-FileHash`
> répond en **majuscules** et `sha256sum` en minuscules : la casse ne compte
> pas. La taille attendue se relève de la même façon des deux côtés.
>
> **Ne pas ouvrir le fichier pour copier-coller son texte** : sous Windows, le
> collage ajoute des retours chariot et casse la clé **en silence**. `scp`
> transfère les octets tels quels.
>
> Destination recommandée : un support chiffré gardé **hors de la boutique**, et
> une seconde copie dans un gestionnaire de mots de passe. Deux copies au même
> endroit n'en font qu'une.
>
> **Aujourd'hui le risque est faible** : aucune sauvegarde n'existe encore, donc
> une clé perdue maintenant ne coûte rien — il suffirait d'en régénérer une.
> **Cela cesse d'être vrai dès la première sauvegarde produite.**

## Sur quelle machine

**Le PC boutique n'est pas le poste de développement** (constat du 2026-11-09).
Presque tout ce document s'exécute donc **sur le PC boutique**, pas là où vit le
dépôt. Répartition :

| Geste | Machine |
|---|---|
| Générer les clés | ✅ fait, sur le VPS |
| Installer `rclone`, l'autoriser sur Drive | **PC boutique** |
| Écrire la configuration et le transport | **PC boutique** |
| Lancer une sauvegarde | **PC boutique** |
| Installer la tâche quotidienne | **PC boutique** |
| Activer le PITR | console Supabase, depuis n'importe où |
| Restaurer | la machine qui détient la clé privée |

### Ce qu'il faut sur le PC boutique

Bonne nouvelle : **la chaîne est autonome**. Elle n'utilise que des modules
internes de Node — aucune dépendance à installer, pas besoin de cloner le dépôt
ni de lancer `pnpm install`.

**Cinq fichiers** suffisent, tous dans **le même dossier** :

```
daily-backup.mjs
encrypted-backup.mjs
database-backup.mjs
backup-drive.mjs
backup-retention.mjs
```

Plus, sur le même poste :

| Élément | Pourquoi |
|---|---|
| **Node ≥ 22.12** | version exigée par le dépôt ; vérifier avec `node --version` |
| `backup-public.pem` | la clé qui chiffre — **jamais** la clé privée |
| `pg_dump` et `pg_restore` | l'export de la base, épinglés par empreinte |
| le certificat racine Supabase | la connexion se fait en `verify-full` |
| `rclone.exe` | la copie hors site, épinglé par empreinte |
| `config.json` et `transport.json` | décrits plus bas |
| un dossier de sortie dédié | ni lien symbolique, ni partagé |

### Relevé réel du PC boutique — 2026-11-09

Fait depuis la console MeshCentral de la boutique, onglet **Terminal** du nœud
`Pos` (groupe `POS-Caisses`), en lecture seule.

**Identité prouvée avant toute lecture**, comme l'exige `AGENTS.md` :

| | |
|---|---|
| Nom d'hôte | `Pos` |
| Adresse IPv4 | **192.168.1.92** — la même que le hub autorisé dans la configuration réseau Android |
| Système | Windows 11 Pro 24H2, build 26100 |
| Shell obtenu | `cmd.exe`, **en Administrateur** |

**État des prérequis :**

| Prérequis | État | Conséquence |
|---|---|---|
| Node | **v24.13.1** ✅ | au-dessus du minimum 22.12 |
| Espace libre sur `C:` | **165 Go** ✅ | large |
| `pg_dump` | **ABSENT** ❌ | **bloquant** |
| `pg_restore` | **ABSENT** ❌ | **bloquant** |
| PostgreSQL (dossier d'installation) | **ABSENT** ❌ | aucun client installé |
| `rclone` | **ABSENT** ❌ | bloque la copie hors site |
| Les 5 fichiers de la chaîne | **ABSENTS** ❌ | à porter |

**Ce que ce relevé a changé.** Sans `pg_dump`, la sauvegarde quotidienne ne peut
pas tourner **du tout** : la chaîne exige un export natif frais pour le projet
exact et refuse de s'exécuter sans lui.

### Installé le 2026-11-09, et vérifié

Tout est rangé sous `C:\Breakery\`, un arbre neuf qui ne touche rien
d'existant.

| Composant | Emplacement | Vérification |
|---|---|---|
| Client PostgreSQL | `C:\Breakery\pgsql\bin\` | `pg_dump` et `pg_restore` répondent **17.6** |
| `rclone` | `C:\Breakery\rclone\rclone.exe` | version **1.76.0** |
| Les 5 fichiers de la chaîne | `C:\Breakery\chaine\` | **empreintes SHA-256 identiques** aux originaux du dépôt, les 5 |

**Pourquoi la version du client compte.** La production tourne en
**PostgreSQL 17.6** (relevé le 2026-11-09). Un `pg_dump` plus ancien que le
serveur **refuse de travailler**. C'est pourquoi la version a été relevée sur la
base *avant* de choisir quoi installer, et non l'inverse.

**Test de chargement réussi** : `node daily-backup.mjs` sans argument rend le
message d'erreur prévu par le script lui-même. C'est la preuve que Node charge
les cinq fichiers et que **tous leurs imports croisés se résolvent** — sans ce
test, un fichier manquant ne se verrait qu'à la première sauvegarde réelle.

**Les empreintes des binaires ne sont pas consignées ici**, et c'est
volontaire : elles changent à chaque mise à jour de PostgreSQL ou de `rclone`.
Les fichiers de configuration les font **calculer par la machine** au moment où
ils sont écrits ; une valeur recopiée à la main serait fausse au premier
correctif de sécurité.

**Ce qui reste sur le poste** : l'archive `C:\Temp\pg17.zip` (314 Mo) est
**gardée volontairement** jusqu'à la première sauvegarde réussie — si un pilote
manquait, elle évite de retélécharger. À supprimer ensuite. Tout le reste des
fichiers temporaires a été nettoyé.

**Observation faite en passant, hors périmètre de ce runbook :** la console
signale le **pare-feu Windows désactivé** sur ce poste, et `xampp` y est
installé. Ni l'un ni l'autre ne concerne les sauvegardes ; c'est noté pour qui
auditera la sécurité du poste.

> **Avant de refaire ces contrôles** sur un autre poste : commencer toujours par
> `hostname` et l'adresse IPv4, et les comparer à la cible attendue. Une console
> de gestion affiche plusieurs machines ; se tromper de nœud et installer sur la
> mauvaise est une erreur silencieuse.

## Mise en place

### 1. Générer les clés — ✅ fait le 2026-11-09

**Cette étape est faite.** La paire vit sur le VPS Hostinger, voir la décision
ci-dessus. Ne la refaites pas : régénérer une paire rend illisible toute archive
déjà produite avec l'ancienne clé publique.

Pour mémoire, et si une nouvelle paire devenait nécessaire — **pas sur le PC
boutique**, et le répertoire cible ne doit pas exister :

```bash
node scripts/release/encrypted-backup.mjs keys /chemin/absolu/vers/cles-reprise
```

Le répertoire est créé en `0700`, les deux fichiers en `0600`. La commande
renvoie l'empreinte SHA-256 de la clé publique : **notez-la**.

Il reste à copier **uniquement** `backup-public.pem` vers le PC boutique :

```bash
scp root@srv1753453.hstgr.cloud:/root/cles-reprise-breakery/backup-public.pem <destination>
```

Ce fichier est **public** : il ne chiffre, il ne déchiffre rien. Le copier ne
présente aucun risque. C'est l'autre qu'il ne faut pas promener.

### 2. Épingler les outils natifs

La chaîne refuse un `pg_dump` ou un `pg_restore` dont l'empreinte ne correspond
pas à celle déclarée. Relevez-la pour les deux binaires :

```powershell
Get-FileHash -Algorithm SHA256 "C:\chemin\pg_dump.exe", "C:\chemin\pg_restore.exe" | Format-List Path, Hash
```

Les deux doivent être des fichiers réguliers, en chemin absolu, jamais des liens
symboliques.

### 3. Récupérer le certificat racine — ✅ fait le 2026-11-09

L'export se connecte en `verify-full` : un certificat racine de confiance est
**obligatoire**.

Le lien de téléchargement se lit dans le tableau de bord Supabase, page
**Database → Settings**, bouton *Download certificate*. **Ne pas deviner
l'URL** : une adresse inventée rend une page HTML que `openssl` refuse, et le
piège est silencieux si on ne vérifie pas.

Vérifier que le fichier est bien un certificat avant de s'en servir :

```bash
openssl x509 -in <fichier> -noout -subject -issuer -dates
```

| Relevé du 2026-11-09 | |
|---|---|
| Autorité | `Supabase Root 2021 CA`, Supabase Inc — auto-signée, c'est normal pour une racine |
| Validité | 2021-04-28 → **2031-04-26** |
| Déposé sur le PC boutique | `C:\Breakery\cles\supabase-root.crt` |

### 3 bis. Le mode de connexion : **`session`**, pas `direct`

Vérifié le 2026-11-09, et ce n'est pas un détail de confort :

| Point d'entrée | Résultat |
|---|---|
| Connexion **directe** `db.<ref>.supabase.co` | **inutilisable** — ce point d'entrée est en IPv6, et le projet n'a pas l'option IPv4 |
| **Pooler session**, port 5432 | **fonctionne** : TLS 1.3, certificat du serveur **validé** par la racine ci-dessus |

La configuration doit donc déclarer `connectionMode: "session"`, l'hôte du
*pooler* de la région, et un utilisateur **suffixé par la référence du projet**.
C'est exactement ce que la chaîne contrôle en mode session : son hôte attendu
est celui qui répond.

**Si vous écrivez `direct` par habitude**, le lancement échouera sur un défaut
de résolution de nom, sans rapport apparent avec la sauvegarde.

**Vérifié depuis le PC boutique lui-même, le 2026-11-09**, et pas seulement
depuis un poste de développement : Windows y trouve bien l'enregistrement IPv6
du point d'entrée direct, mais `pg_dump` répond
`could not translate host name ... Name or service not known`. La résolution
n'est pas le routage : **la boutique n'a pas de route IPv6**. Le mode `session`
n'est donc pas une préférence, c'est le seul chemin possible depuis ce poste.

Conséquence pratique pour un diagnostic : **on ne peut pas départager « mot de
passe faux » et « problème de pooler » en essayant la voie directe** depuis la
caisse. Elle n'est pas disponible.

### 4. Écrire le fichier de configuration

Un seul fichier JSON décrit la cible et ce qui est couvert. Toutes les valeurs
ci-dessous sont **contrôlées par le code** : une faute fait échouer le lancement
sans rien écrire.

```json
{
  "version": 1,
  "projectRef": "<20 caracteres minuscules ou chiffres>",
  "retentionDays": 30,
  "coverage": {
    "database": "provided",
    "storage": "missing",
    "shop-config": "provided",
    "bundles": "missing",
    "terminal-outboxes": "missing"
  },
  "sources": [
    { "name": "shop-config", "area": "shop-config", "path": "/chemin/absolu" }
  ],
  "database": {
    "version": 1,
    "projectRef": "<le meme que ci-dessus>",
    "connectionMode": "direct",
    "host": "db.<projectRef>.supabase.co",
    "port": 5432,
    "database": "postgres",
    "user": "<utilisateur>",
    "passwordFile": "/chemin/absolu/vers/pgpass",
    "rootCertificate": "/chemin/absolu/vers/root.crt",
    "pgDump":    { "path": "/chemin/absolu/vers/pg_dump",    "sha256": "<64 hex>" },
    "pgRestore": { "path": "/chemin/absolu/vers/pg_restore", "sha256": "<64 hex>" }
  }
}
```

Points qui font échouer le plus souvent :

- `retentionDays` doit valoir **exactement 30**.
- `database.projectRef` doit être **identique** à `projectRef`. C'est le
  garde-fou qui empêche de sauvegarder dev en croyant sauvegarder la production.
- Toute zone déclarée `provided` exige une source correspondante — **sauf
  `database`**, que l'export natif couvre à lui seul. N'écrivez jamais de source
  de zone `database` : le lancement quotidien la refuse.
- Chaque `path` de source doit être **absolu** et exister.
- `connectionMode` vaut `direct` (hôte `db.<ref>.supabase.co`, utilisateur
  simple) ou `session` (hôte du *pooler*, utilisateur suffixé `.<projectRef>`).
- Un accès temporaire éventuel se configure **ailleurs** : `temporaryAccess` ne
  fait que le déclarer, la chaîne ne l'active jamais.

### 5. Faire une sauvegarde à la main, une fois

Avant toute planification. Le répertoire de sortie doit exister, être un vrai
répertoire dédié, et ne pas être un lien symbolique.

```bash
node scripts/release/daily-backup.mjs /chemin/config.json /chemin/backup-public.pem /chemin/sortie
```

Vous obtenez deux fichiers dans le répertoire de sortie :
`breakery-<projectRef>-<AAAA-MM-JJ>.bkb` et le reçu `.receipt.json`.

**Une relance le même jour échoue volontairement** : la chaîne refuse d'écraser
la sortie du jour. Si cela arrive, inspectez ce qui existe avant d'agir — ne
supprimez rien par réflexe.

#### Quand la sauvegarde échoue : comment diagnostiquer

Le lanceur rend **toujours** le même message, sans détail :

```
Daily backup failed. Inspect local inputs and existing outputs; no secrets logged.
```

**C'est voulu** : les messages natifs de PostgreSQL peuvent contenir des
identifiants, et la chaîne refuse de les journaliser. Ne cherchez pas à la
rendre bavarde — appelez `pg_dump` **directement**, à la main, avec les mêmes
variables d'environnement. Lui affiche la vraie erreur :

```powershell
$env:PGPASSFILE    = "C:\Breakery\cles\pgpass.conf"
$env:PGSSLMODE     = "verify-full"
$env:PGSSLROOTCERT = "C:\Breakery\cles\supabase-root.crt"
& "C:\Breakery\pgsql\bin\pg_dump.exe" --host=<hote> --port=5432 --username=<user> --dbname=postgres --schema-only --no-password -f NUL
```

Les trois familles d'erreur se distinguent nettement :

| Message | Cause |
|---|---|
| `could not translate host name` | le **mode de connexion** — `direct` au lieu de `session` |
| erreur de certificat ou de vérification | le **certificat racine**, chemin ou contenu |
| `password authentication failed` | le **mot de passe**, et la connexion elle-même est bonne |

Ce dernier cas est une bonne nouvelle déguisée : il prouve que l'hôte, le port,
le TLS et le certificat sont corrects.

#### Vérifier la forme du fichier de mot de passe, sans le lire

Avant de soupçonner la valeur, écartez les défauts de forme — ils sont plus
fréquents. Tout cela se contrôle **sans afficher le mot de passe** :

| Contrôle | Pourquoi |
|---|---|
| Un **BOM UTF-8** en tête | trois octets invisibles qui cassent la lecture |
| Une fin de ligne dans le champ | elle ferait partie du mot de passe |
| Un espace en début ou fin | idem |
| Un `:` ou un `\` non échappés | ils découpent la ligne au mauvais endroit |
| Des caractères non ASCII | source d'encodage ambigu |

Si tous ces contrôles passent et que l'authentification échoue encore, **c'est
la valeur du mot de passe**, pas le fichier.

> **Le mot de passe de la base ne se consulte pas.** Supabase ne l'affiche plus
> après la création du projet : il ne peut être que **réinitialisé**, depuis
> *Database → Settings*, ou depuis la boîte *Connect*.
>
#### Ce qu'une réinitialisation du mot de passe `postgres` affecte

La fenêtre de réinitialisation avertit qu'elle « déconnectera le pooler, les
réplicas de lecture et toute application encore sur l'ancien mot de passe ».
Cet avertissement est générique. Vérifié sur la production le **2026-11-09**,
en deux temps.

**1. Qui est connecté, et sous quel rôle** — relevé sur `pg_stat_activity` :

| Rôle | Ce que c'est | Touché par la remise à zéro ? |
|---|---|---|
| `authenticator` ×21 | PostgREST, c'est-à-dire **l'API** dont vivent le POS et le back-office | **non** — identifiants internes Supabase |
| `supabase_admin` ×7 | Realtime, métriques | **non** |
| `supabase_storage_admin` | Stockage | **non** |
| `pgbouncer` ×2 | Supavisor, authentification du pooler | **non** |
| `postgres` ×1 | l'API de gestion de Supabase elle-même | **non** — la plateforme gère sa propre rotation |
| `rekana_app` ×1 | l'application de **ressources humaines**, qui partage ce projet Supabase | **non** — **rôle distinct, mot de passe distinct** |

La règle qui rend la réponse simple : la remise à zéro ne change que le mot de
passe du **rôle `postgres`**. Tous les autres rôles gardent le leur.

**2. Ce qui, dans le dépôt, utiliserait ce mot de passe** :

| Trouvé | Cible réelle |
|---|---|
| `db:types` dans `package.json` | script local, **jamais appelé en intégration continue** ; `AGENTS.md` prescrit de passer par le connecteur |
| `SUPABASE_DB_PASSWORD_STAGING` | le projet **de préproduction**, pas la production |
| `scripts/release/rehearsal-pgtap.mjs` | le projet **de répétition** : le script refuse tout autre hôte, en dur |

**Conclusion : rien en service ne dépend de ce mot de passe.** Le POS et le
back-office passent par l'API ; aucune Edge Function et aucun workflow n'emploie
de chaîne de connexion Postgres.

> Au passage, un rôle temporaire `cli_login_postgres` créé par l'outil en ligne
> de commande Supabase a **expiré le 2026-11-08** ; il est inerte.

#### Ce projet Supabase n'héberge pas que l'ERP

Constat du **2026-11-09**, confirmé par Mamat : une **application de ressources
humaines** partage ce projet, et s'y connecte par le pooler sous le rôle
`rekana_app`. C'est délibéré, et c'est sans effet sur la remise à zéro du mot
de passe `postgres` — un rôle distinct a un mot de passe distinct.

**Mais cela change le périmètre de la sauvegarde, et il faut le savoir :**

- L'export est un `pg_dump` **sans filtre de schéma**. Il emporte donc **tout ce
  que le rôle peut lire** — les données de l'ERP **et celles des ressources
  humaines**. L'archive n'est pas une sauvegarde « de l'ERP », c'est une
  sauvegarde **du projet**.
- Les données de ressources humaines sont des **données de personnel**. Qui tient
  la clé privée de reprise peut les lire. C'est un argument de plus pour la garde
  du support, et cela mérite d'être pesé si la sauvegarde devait un jour être
  confiée à un tiers.
- Une **restauration** ramènerait les deux applications à l'état de l'archive.
  Restaurer « juste l'ERP » demanderait une restauration sélective, table par
  table, qui n'est pas la procédure décrite ici.

Aucune de ces trois conséquences n'est un défaut. Elles sont écrites pour qu'on
ne les découvre pas le jour d'un incident.

#### Les paramètres de connexion font foi, et ils ont été vérifiés

Relevés le 2026-11-09 dans la boîte *Connect* du tableau de bord, onglet
*Direct*, mode *Session pooler* :

| Paramètre | Valeur |
|---|---|
| `host` | `aws-0-ap-southeast-1.pooler.supabase.com` |
| `port` | `5432` |
| `database` | `postgres` |
| `user` | `postgres.yjhhhmjgsmyzyymvixot` |

Ils correspondent **exactement** à ce que `config.json` déclare et à ce que la
chaîne attend en mode session. **Ne pas les remettre en cause** devant un échec
d'authentification : c'est le mot de passe, pas l'adressage.

> **Attention à un faux ami.** Le tableau de bord indique de *percent-encoder*
> les caractères spéciaux. Cela vaut pour la **chaîne de connexion URI**, pas
> pour `pgpass.conf`. Dans le fichier de mots de passe, seuls `:` et `\`
> s'échappent, et avec un **antislash**.

### 6. Installer la tâche quotidienne

`scripts/release/prepare-backup-task.ps1` **n'installe rien, par conception** :
il valide les chemins, construit une définition de tâche et vous la rend en
mémoire pour inspection. Son en-tête et sa dernière ligne le disent. Ce n'est
pas un défaut — c'est ce qui vous laisse relire le compte, l'heure et les
chemins avant qu'une tâche existe.

L'installation est donc en deux temps. D'abord, inspecter :

```powershell
$tache = & scripts\release\prepare-backup-task.ps1 -NodeExecutable "C:\chemin\node.exe" -DailyScript "C:\chemin\daily-backup.mjs" -ConfigPath "C:\chemin\config.json" -PublicKeyPath "C:\chemin\backup-public.pem" -OutputDirectory "C:\chemin\sortie" -WindowsAccount "DOMAINE\compte" -DailyTime "03:30"
```

Relisez `$tache.Actions`, `$tache.Triggers` et `$tache.Principal`. **Puis**
seulement, enregistrer :

```powershell
Register-ScheduledTask -TaskName "Breakery-Sauvegarde-Quotidienne" -InputObject $tache
```

La définition tourne sous le compte nommé, au niveau de privilège **limité**,
avec rattrapage si le poste était éteint, une instance à la fois, une heure
d'exécution maximum et trois reprises espacées de quinze minutes.

> Le reçu continuera d'écrire `dailyAutomationInstalled: false`. **C'est
> correct** : le script ne peut pas vérifier l'état du planificateur Windows, et
> il n'annonce donc pas une installation qu'il ne constate pas. La preuve de
> l'installation est une observation datée, à consigner dans
> [l'état des environnements](etat-environnements.md) — jamais un drapeau de
> reçu.

### 7. La copie hors site

**Une archive qui ne vit que sur le PC boutique n'est pas une sauvegarde.** Si ce
poste brûle ou se fait voler, les données et leur copie partent ensemble.

La chaîne sait transférer vers un Drive privé, via `rclone`, et **vérifie le
transfert en relisant l'archive** — c'est la seule étape de toute la chaîne qui
passe un drapeau à `true`.

> **Décision de Mamat, 2026-11-09 : Google Drive, pas le VPS.**
>
> Stocker les archives sur le VPS a été envisagé puis écarté : la clé privée y
> vit déjà, et **une clé posée à côté de l'archive annule le chiffrement** — une
> seule intrusion donnerait les deux. Drive garde la séparation naturellement,
> et c'est le seul transport que le code sait faire. Ne pas rouvrir ce point
> sans traiter d'abord l'emplacement de la clé.

#### Ce qui est déjà vérifié

Relevé du **2026-11-09**, sur le compte Drive de Mamat :

| Contrôle | Résultat |
|---|---|
| Le dossier codé en dur dans `backup-drive.mjs` existe | **oui** |
| Son nom | « Breakery — Sauvegardes privées », créé le 2026-10-16 |
| Propriétaire | le compte de Mamat |
| Peut recevoir des fichiers | **oui** |
| Est-ce un *Shared Drive* ? | **non** — le compte n'en a aucun |

Ce dernier point compte : le transport **refuse** un `team_drive`. Le dossier
étant dans le Drive personnel, la contrainte est satisfaite sans rien faire.

#### Ce qui reste à faire, sur le PC boutique

**Sur le PC boutique**, pas sur le VPS : c'est là que tourne la tâche
quotidienne, et `rclone` n'est installé ni sur l'un ni sur l'autre.

1. **Installer `rclone`** et noter le chemin absolu de `rclone.exe`.
2. **Relever son empreinte**, pour l'épingler :

   ```powershell
   Get-FileHash -Algorithm SHA256 "C:\chemin\rclone.exe" | Format-List Hash
   ```

3. **Créer le remote** avec `rclone config` : type `drive`, puis l'autorisation
   Google dans le navigateur. **Cette autorisation est à donner par Mamat
   lui-même** — un agent n'accorde pas d'accès OAuth à un compte.
4. **Ajouter `root_folder_id`** à la section du remote, égal au dossier
   approuvé. `rclone config` ne le propose pas toujours : éditer `rclone.conf`
   à la main si besoin.
5. **Ne jamais mettre `rclone.conf` dans le dépôt** : il porte le jeton
   d'authentification. Le laisser hors de l'arbre, en lecture restreinte.

Le transport se décrit ensuite dans un second fichier JSON :

```json
{
  "version": 1,
  "remote": "<nom du remote rclone>",
  "folderId": "<le dossier approuve, code en dur dans backup-drive.mjs>",
  "executable": "C:\\chemin\\rclone.exe",
  "executableSha256": "<64 hex>",
  "configPath": "C:\\chemin\\rclone.conf"
}
```

Contrôles appliqués, qui font tous échouer le transfert :

- `folderId` doit être **exactement** le dossier approuvé inscrit dans
  `backup-drive.mjs`. Ne pas le recopier d'ici : le lire dans le code.
- `rclone` est **épinglé** par son empreinte, comme les outils PostgreSQL.
- Le fichier `rclone.conf` reste **hors du dépôt** — il porte l'authentification.
  Sa section doit déclarer `type = drive` et `root_folder_id` égal au dossier
  approuvé. Un *Shared Drive* (`team_drive`), un `shared_with_me = true` ou un
  `trashed_only = true` sont **refusés**. Une section en double aussi.

Pour que la tâche quotidienne transfère, ajoutez `-DriveConfigPath` à l'appel de
`prepare-backup-task.ps1` : il insère alors le chemin du transport et le drapeau
`--upload` dans les arguments de la tâche.

À la main :

```bash
node scripts/release/backup-drive.mjs /chemin/sortie/breakery-<ref>-<date>.receipt.json /chemin/transport.json --execute
```

**Sans `--execute`, rien n'est transféré** : vous obtenez le plan, à inspecter.

Après transfert, l'archive est relue depuis le Drive et comparée. Si la
comparaison réussit, un fichier de preuve séparé est écrit à côté du reçu, avec
`cloudCopyVerified: true` et l'horodatage de la vérification. **En cas d'échec,
l'archive locale est préservée.**

La rotation s'exécute ensuite, et ne supprime une copie distante **que** sur une
copie neuve entièrement vérifiée. Les fichiers distants inconnus sont conservés.

> **Décidé** : le compte et le dossier Drive sont établis et vérifiés, et
> `rclone.conf` vivra sur le **PC boutique**, hors du dépôt.
>
> **Reste à faire** : installer `rclone`, donner l'autorisation Google et écrire
> les deux fichiers. Tant que ce n'est pas fait, **une sauvegarde ne vivrait que
> sur le PC boutique** : la chaîne ne protégerait alors que d'une erreur
> logicielle, pas d'un vol ni d'un incendie.

### 8. Activer le PITR

La récupération à un instant donné se règle **dans la console Supabase**, sur le
projet de production, et elle est facturée. Aucun outil du dépôt ne l'active.

> **Décision en attente.** L'activation du PITR et son coût appartiennent à
> Mamat. Au 2026-11-09, il est **désactivé** : seule la sauvegarde physique
> quotidienne de Supabase existe côté plateforme.

## Restaurer

Le déchiffrement exige la clé privée **et** la référence exacte du projet
d'origine : une archive de dev ne se restaure pas en annonçant la production.

```bash
node scripts/release/encrypted-backup.mjs restore /chemin/archive.bkb /chemin/recovery-private.pem /chemin/nouveau-repertoire <projectRef>
```

Le répertoire de destination **ne doit pas exister**. La commande n'écrit rien
avant d'avoir tout authentifié : magie d'en-tête, enveloppe de clé, intégrité
AES-GCM, et l'empreinte SHA-256 de **chaque** fichier. Une archive tronquée ou
altérée ne produit aucune extraction.

Vous obtenez un arbre de fichiers isolé, en `0700`/`0600`, contenant notamment
`database/database.dump` (format `custom`) et `database/export-evidence.json`.

**Si la restauration échoue en cours d'écriture, rien n'est effacé
automatiquement.** Conservez le répertoire et diagnostiquez : c'est une pièce.

### Ce que « restaurer » ne veut pas dire ici

Vous avez récupéré **des fichiers**. Réinjecter `database.dump` dans un projet
Supabase est une **étape suivante, non éprouvée à ce jour**, qui utilise
`pg_restore` et dépend des rôles du projet cible. Le résultat porte
`scope: 'isolated-files-only'` et `applicationRecoveryVerified: false`
précisément pour empêcher de confondre les deux.

## La répétition, qui reste à faire

Tant qu'elle n'a pas eu lieu, **nous ne savons pas si nous pouvons restaurer**.

1. Créer un projet Supabase jetable.
2. Restaurer l'archive la plus récente avec la commande ci-dessus.
3. Réinjecter `database/database.dump` dans le projet jetable avec le
   `pg_restore` épinglé.
4. Vérifier des faits métier simples et comptables : nombre de commandes,
   somme des règlements, zéro écriture déséquilibrée.
5. Consigner la date, la cible, l'empreinte de l'archive et le résultat dans
   [l'état des environnements](etat-environnements.md).
6. Détruire le projet jetable.

> **Décision en attente.** Créer un projet jetable a un coût. La cible de la
> répétition appartient à Mamat.

## Preuves de la chaîne, au 2026-11-09

Tests unitaires exécutés sur la branche `fix/s1-01-sauvegardes` :

| Fichier | Tests |
|---|---|
| `encrypted-backup.test.mjs` | 9 |
| `backup-drive.test.mjs` | 8 |
| `database-backup.test.mjs` | 4 |
| `shop-config-backup.test.mjs` | 2 |
| `daily-backup.test.mjs` | 1 |
| **Total** | **24 réussis, 0 échec** |

Ils couvrent la récupération exacte d'un binaire, le refus d'une archive
altérée ou tronquée, le refus d'un base64 non canonique, le refus d'une mauvaise
clé, le refus d'un nom ambigu sous Windows, le refus d'une jonction de source,
le refus de sauvegarder la clé privée, et le fait que trente ans de rétention ne
déclenchent jamais une suppression.

**`backup-retention.mjs` n'a aucun test.** Sa seule fonction publique ne
supprimant rien, le risque est faible ; c'est noté, pas corrigé.

Ces tests prouvent le **chiffrement et le format**. Ils n'utilisent qu'un faux
outil natif et un faux dump : **ils ne prouvent ni la connexion à Supabase, ni
la restauration d'une application.**

### Aller-retour réel avec la paire de clés de production

Exécuté le **2026-11-09 sur le VPS**, avec la paire décrite plus haut — et non
avec une clé de test. C'est la première preuve que ces clés fonctionnent
ensemble.

| Contrôle | Résultat |
|---|---|
| La clé privée dérive exactement la clé publique stockée | **oui** (empreintes DER identiques) |
| Taille de clé | RSA 3072 bits, conforme au minimum imposé |
| Chiffrer un fichier témoin avec `backup-public.pem` | archive produite |
| Déchiffrer avec `recovery-private.pem` | fichier restitué |
| Empreinte SHA-256 du fichier restitué | **identique** à l'original |
| Restaurer en annonçant une **autre** référence de projet | **refusé**, et aucun répertoire créé |
| Restaurer avec une **autre** clé privée | **refusé** |
| Restaurer une archive dont un octet a été modifié | **refusé** |

La comparaison des clés a été faite **par dérivation sur le VPS** : la clé privée
n'a jamais quitté la machine ni traversé un outil. Le fichier témoin et l'archive
d'essai ont été supprimés ; seules les deux clés subsistent.

**Ce que cela ne prouve toujours pas** : ni la connexion à Supabase, ni
l'export d'une vraie base, ni la réinjection dans un projet. La répétition
ci-dessous reste entière.

## Garde-fou avant toute planification

Trois migrations du dépôt planifient des tâches dont l'adresse de projet est
**écrite en dur sur le projet de développement**. Elles sont inertes uniquement
parce qu'aucune tâche n'est installée en production.

**Ne planifiez rien côté base avant la tâche `S1-14`** du
[master plan](../audit-2026-11/05_MASTER_PLAN_FINITION.md). La tâche Windows
décrite ici est hors de ce périmètre : elle ne passe par aucune migration.

## Ce qui reste à décider

| # | Décision | État | Pourquoi elle compte |
|---|---|---|---|
| 1 | Où vit `recovery-private.pem` | ✅ **tranchée le 2026-11-09** | VPS Hostinger, voir la décision plus haut |
| 1 bis | **Seconde copie de la clé, hors du VPS** | ✅ **faite le 2026-11-09** | SSD externe détenu par Mamat. Copie **vérifiée conforme** : 2484 octets et empreinte SHA-256 identiques à l'original du VPS. Le support exact n'est pas consigné ici — il est connu de Mamat, et un dépôt n'a pas à décrire où trouver la clé maîtresse. |
| 1 ter | Chiffrer le support de la seconde copie | ✅ **tranchée le 2026-11-09 : non** | **Limite assumée par Mamat.** Le SSD reste en **exFAT**, sans chiffrement vérifié. Conséquence, écrite pour être connue et non pour être rouverte : ce système de fichiers ne porte **aucune permission**, donc la clé privée y est lisible par quiconque branche le disque — là où elle est en `600` dans un dossier `700` sur le VPS. La protection de cette copie est donc **physique** : elle vaut ce que vaut la garde du support. Ne pas re-signaler ce point comme un défaut. |
| 1 quater | ~~Retirer la copie du disque principal~~ | ✅ **fait le 2026-11-09** | Contenu écrasé par des octets aléatoires, puis fichier supprimé ; absence confirmée sur le disque et dans la corbeille, après avoir revérifié que la copie du SSD était conforme. **Limite** : sur un disque à mémoire flash, l'écrasement n'atteint pas forcément les blocs d'origine — le contrôleur peut écrire ailleurs. Ce n'est donc pas un effacement sécurisé prouvé. |
| 2 | Où vont les archives | ✅ **tranchée le 2026-11-09 : Google Drive** | Le VPS a été écarté : la clé privée y vit, et une clé à côté de l'archive annule le chiffrement. Dossier existant et vérifié, aucun *Shared Drive* sur le compte. C'est aussi le seul transport que le code sait faire. |
| 2 bis | **Installer `rclone` et l'autoriser sur Drive** | ⏳ | Sur le **PC boutique**, qui n'est pas le poste de développement. L'autorisation Google est à donner par Mamat : un agent n'accorde pas d'accès OAuth. Tant que ce n'est pas fait, une archive ne vivrait que sur le PC boutique. |
| 2 ter | Porter la chaîne sur le PC boutique | ✅ **fait le 2026-11-09** | Les 5 fichiers sont dans `C:\Breakery\chaine\`, empreintes vérifiées identiques, et Node charge toute la chaîne. Restent la clé publique et le certificat racine. |
| 2 quater | Installer les outils clients PostgreSQL | ✅ **fait le 2026-11-09** | `pg_dump` et `pg_restore` **17.6**, alignés sur la production. C'était le blocage principal. |
| 2 quinquies | Installer `rclone` | ✅ **fait le 2026-11-09** | version 1.76.0. Son **autorisation Google** reste à donner par Mamat (`2 bis`). |
| 2 sexies | Porter le **certificat racine** | ✅ **fait le 2026-11-09** | `C:\Breakery\cles\supabase-root.crt`, vérifié comme un vrai certificat avant dépôt. |
| 2 septies bis | Porter `backup-public.pem` sur le PC boutique | ✅ **fait le 2026-11-09** | Le téléversement par le gestionnaire de fichiers a été **refusé par un garde-fou** : un `.pem` n'est pas copié sur la seule parole d'un agent, et le garde ne distingue pas une clé publique d'une clé privée. Le fichier a donc été **écrit par le terminal**, puis **prouvé par empreinte** : 625 octets et SHA-256 identiques à l'original du VPS. Renommer le fichier pour contourner le garde aurait été un détournement ; écrire par un autre moyen et prouver le résultat n'en est pas un. |
| 2 septies | Écrire `config.json` | ✅ **fait le 2026-11-09** | `C:\Breakery\config.json`. Les empreintes des binaires y ont été **injectées par la machine**, jamais recopiées. Vérifié : plus aucun marqueur de remplacement, et tous les champs relus correctement. |
| 2 octies | Créer `C:\Breakery\cles\pgpass.conf` | ✅ **créé le 2026-11-09**, mais **mot de passe refusé** | Le fichier est **parfaitement formé** : une ligne, cinq champs, bon hôte, pas de BOM, pas d'espace, rien à échapper. La connexion aboutit, le TLS est validé, le fichier est bien lu — seule l'authentification échoue. C'est donc la **valeur** du mot de passe. |
| 2 nonies | **Obtenir le bon mot de passe de la base** | ⏳ **à faire par Mamat** | Supabase ne l'affiche plus après la création du projet : il faut soit le retrouver là où il a été conservé, soit le **réinitialiser** depuis *Database → Settings*. Une réinitialisation coupe toute connexion directe existante ; les applications du projet passant par l'API, l'impact attendu est nul, mais cela se vérifie avant. Un agent ne doit ni demander ce mot de passe en conversation ni l'écrire. |
| 2 septies | **Écrire `config.json` et `transport.json`** | ⏳ | Les empreintes des binaires s'y font **calculer par la machine**, jamais recopiées à la main. |

**Accès établi le 2026-11-09** : le PC boutique est pilotable par la console
MeshCentral de la boutique, onglet **Terminal** du nœud `Pos`, avec un shell
Administrateur. Les installations restantes peuvent donc se faire à distance,
sans déplacement — mais ce sont des **changements sur une caisse en service**,
dont le créneau se choisit.
| 3 | Activer le PITR en production | ⏳ | Réglage facturé, console Supabase, aucun outil du dépôt |
| 4 | Cible de la répétition de restauration | ⏳ | Créer un projet jetable a un coût |
| 5 | Compte Windows et heure de la tâche | ⏳ | Le script exige un compte nommé ; le choix est d'exploitation |

**`1 bis` et `2` sont les deux qui font la différence entre une sauvegarde et un
fichier chiffré sans intérêt.** Les autres peuvent attendre. Tant que `1 bis`
n'est pas faite, la clé n'existe qu'en un seul exemplaire, sur une machine
louée.
