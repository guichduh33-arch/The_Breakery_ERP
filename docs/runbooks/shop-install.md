# Runbook — installer une release POS + bridge sur le PC boutique

> Périmètre : la mise à jour du bundle POS et du bridge servis par le PC caisse,
> à partir de l'archive produite par le workflow `package-shop-release.yml`.
> Ni la base, ni les Edge Functions, ni le back-office, ni les tablettes
> Android ([guide tablette](tablet-capacitor-build.md)) ne sont concernés.

## Ce que fait l'installateur

Le paquet contient `install-shop.ps1` (pilotage Windows), `install-shop.mjs`
(contrôles et écritures de fichiers) et `verify-shop.mjs` (identité et
empreintes du paquet). `Mettre-a-jour.cmd` lance le script PowerShell.

Le lanceur réel est un fichier JavaScript (`start.cjs`) relevé le 2026-11-10 :
il lit une configuration externe hors des releases, pose `POS_DIST_DIR` et
importe le `server.js` du bridge. Ses chemins Windows y sont écrits en
littéraux échappés (doubles barres obliques inverses). L'installateur remplace
exactement une fois le chemin du bridge et celui du POS, chacun comme chaîne
entière. Il refuse le lanceur si un de ces chemins manque ou se répète, si une
autre trace de l'ancienne release subsiste (forme échappée, simple ou avec `/`,
casse ignorée) ou si la configuration externe n'y est plus référencée.

Aucune constante de livraison n'est éditée dans un script. Le SHA vient du
`release.json` du paquet ; l'empreinte de l'archive vient du fichier
`shop-release.zip.sha256` publié par le même workflow. Le `release.json` lu
dans l'archive doit être identique, octet pour octet, à celui du paquet extrait,
puis `verify-shop.mjs` contrôle chaque fichier contre ce manifeste.

Limite : le fichier `.sha256` voyage dans le même artefact que l'archive. Il
détecte une archive abîmée ou mal copiée, pas une archive substituée avec son
digest. La confiance repose sur le téléchargement depuis le run protégé du
workflow ; relever le numéro du run et l'empreinte de l'archive dans les preuves.

## Étapes de l'installateur

1. **Contrôles sans écriture.** Configuration version 2 ; chemins absolus sans
   point de réanalyse ; tâche planifiée en cours avec une seule action, le compte
   attendu et le lanceur attendu ; un seul processus du Node vérifié exécutant
   ce lanceur.
2. **Préparation** (`stage`). Empreintes de l'archive, du paquet, du Node, de
   la configuration externe et du lanceur ; paquet installable avec ses preuves
   CI et pgTAP ; `/health` sain sur chaque origine, dont le `release_sha` est
   relevé. Ensuite seulement : copie du payload dans `<releasesDir>\<sha>`,
   vérification de la copie, sauvegarde `start.cjs.rollback-<sha>`, nouveau
   lanceur `start.cjs.update-<sha>` et journal `installation.json` (`staged`).
3. **Bascule** (`switch`). Tâche arrêtée, lanceur et configuration externe
   recontrôlés, remplacement atomique du lanceur (`switched`), redémarrage.
4. **Vérification** (`verify`). Sur **chaque** origine : `release_sha` égal au
   SHA livré, puis chaque fichier POS servi égal au manifeste. Lanceur et
   configuration externe recontrôlés. Journal `verified`.
5. **Retour automatique** si la vérification échoue après la bascule :
   arrêt, restauration du lanceur sauvegardé (`restore`), redémarrage, puis
   preuve que chaque origine sert de nouveau le `release_sha` relevé avant
   l'arrêt (`restored`). Journal `rolled-back`.

L'installateur n'écrit jamais dans la configuration externe, les certificats,
le registre d'appairage, le buffer ni le stockage des navigateurs. L'ancienne
release reste sur le disque.

## Préparer la livraison

1. Télécharger l'artefact du workflow protégé : `shop-release.zip` **et**
   `shop-release.zip.sha256`. Les copier ensemble sur le PC boutique, dans un
   répertoire de mise à jour hors des releases.
2. Extraire avec le `tar` de Windows, pas `Expand-Archive` qui échoue sur les
   chemins longs de `node_modules` :

   ```powershell
   New-Item -ItemType Directory C:\BreakeryV3\updates-<sha>\package
   & "$env:SystemRoot\System32\tar.exe" -xf C:\BreakeryV3\updates-<sha>\shop-release.zip -C C:\BreakeryV3\updates-<sha>\package
   ```

   Le `tar` de Git (GNU) ne lit pas les zip : appeler celui de `System32`.
3. Remplir `shop-update.json` depuis `shop-update.example.json`, hors du paquet.
   Toutes les valeurs se relèvent sur le poste, sans les deviner :

   | Champ | Source |
   |---|---|
   | `sha` | `release.json` du paquet extrait |
   | `taskName`, `taskPath`, `taskUser` | tâche planifiée et son compte |
   | `nodePath`, `nodeSha256` | Node exécuté par la tâche, `Get-FileHash` |
   | `launcherPath`, `launcherSha256` | lanceur référencé par la tâche, `Get-FileHash` |
   | `externalConfigPath`, `externalConfigSha256` | configuration lue par le lanceur, `Get-FileHash` |
   | `previousRelease`, `oldBridgeEntry`, `oldPosDist` | chemins actuellement écrits dans le lanceur |
   | `releasesDir` | répertoire parent de `previousRelease` |
   | `caCertificate` | certificat de confiance des origines HTTPS |
   | `archivePath` | `shop-release.zip` copié à l'étape 1 |
   | `origins` | toutes les origines HTTPS servies, chacune en `https://hôte[:port]/` |

   Après chaque livraison, le lanceur, son empreinte et la release précédente
   changent : rafraîchir ces champs avant la livraison suivante. Le fichier ne
   contient ni PIN, ni jeton, ni clé.
4. Vérifier que la caisse est inactive, puis lancer depuis le paquet extrait :

   ```powershell
   C:\BreakeryV3\updates-<sha>\package\Mettre-a-jour.cmd C:\BreakeryV3\updates-<sha>\shop-update.json
   ```

   Le succès affiche `SHOP_RELEASE_VERIFIED <sha>`.
5. Recharger le POS caisse, l'écran client et les tablettes ; vérifier le bundle
   chargé et l'imprimante. Une santé HTTP ne prouve ni une sortie papier ni un
   encaissement.

## En cas d'échec

- **Refus avant l'arrêt** : rien n'est installé ni modifié, le service continue.
  Corriger la cause (empreinte, configuration, disposition du lanceur) ; ne pas
  forcer.
- **Refus après la copie, avant l'arrêt** : `<releasesDir>\<sha>`, la
  sauvegarde ou le fichier `.update-<sha>` peuvent exister ; une nouvelle
  tentative est refusée. `installation.json` est écrit en dernier : s'il manque,
  la préparation s'est arrêtée avant lui. Déplacer ces copies hors des releases
  avant de relancer. Ne rien supprimer sans inventaire.
- **« Task does not reference the verified launcher »** : la comparaison est
  exacte, casse comprise. Recopier le chemin tel que la tâche l'écrit.
- **« Rollback incomplete »** : garder le POS fermé. La sauvegarde
  `start.cjs.rollback-<sha>` et `installation.json` permettent de reprendre ; une
  restauration manuelle se vérifie ensuite sur chaque origine.
- **Coupure électrique** pendant l'opération : lire `installation.json` et
  comparer le lanceur à sa sauvegarde avant toute nouvelle tentative.

Le retour automatique ne touche pas la base : une migration déjà appliquée
reste appliquée.
