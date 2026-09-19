# Runbook — fabriquer et installer l'application tablette (Capacitor)

> Périmètre : la coquille Android de la tablette de salle (ADR-029). Le code
> applicatif est le bundle web du POS, embarqué tel quel dans l'APK
> (arbitrage du 2026-08-23 : bundle embarqué, pas de chargement distant).
> Une mise à jour de l'application = refabriquer l'APK et le réinstaller.

## Ce qu'il faut sur le poste de fabrication

| Outil | Version | Où |
|---|---|---|
| JDK | 21 | Définir `JAVA_HOME` vers le JDK 21 installé ; fabrication du 19 septembre 2026 vérifiée avec Microsoft JDK 21.0.6.7 |
| SDK Android | platform-tools + platforms;android-36 + build-tools;36.0.0 | `%LOCALAPPDATA%\Android\Sdk` ; vérifier `apps/pos/android/variables.gradle` lors d'une évolution |
| Node + pnpm | ceux du dépôt (`packageManager` fait foi) | — |

Le SDK s'installe sans Android Studio, par les command-line tools
(`sdkmanager`). Les licences Google doivent être acceptées une fois
(`sdkmanager --licenses`).

## Fabriquer l'APK de debug

Depuis la racine du dépôt :

```powershell
# 1. Construire le bundle web (tsc + vite). Vite lit le .env à la RACINE.
pnpm --filter @breakery/app-pos build

# 2. Copier le bundle dans la coquille et régénérer capacitor.config.json.
cd apps/pos
npx cap sync android

# 3. Fabriquer l'APK.
# Exemple du poste vérifié le 19 septembre 2026 ; adapter au JDK installé.
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.6.7-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

Sortie : `apps/pos/android/app/build/outputs/apk/debug/app-debug.apk`.

## Installer sur la tablette

Avant diffusion, augmenter `versionCode` et `versionName` dans
`apps/pos/android/app/build.gradle`. Conserver `com.thebreakery.pos` et le
certificat déjà installé. Comparer les empreintes de certificat de l'ancienne
et de la nouvelle APK avec `apksigner verify --print-certs`, puis calculer
l'empreinte du fichier avec `Get-FileHash -Algorithm SHA256`.

Activer le débogage USB sur la tablette (Options développeur), la brancher,
identifier son numéro avec `adb devices`, puis cibler ce numéro :

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s NUMERO_APPAREIL install -r apps/pos/android/app/build/outputs/apk/debug/app-debug.apk
```

Sans câble : copier l'APK sur la tablette (lien de partage, clé USB) et
l'ouvrir — Android demandera d'autoriser l'installation d'origine inconnue.
L'application s'appelle **The Breakery POS** (`com.thebreakery.pos`,
arbitrage du 2026-08-23 : identité du socle conservée) et démarre sur
l'écran tablette de salle (`/tablet`).

Ne pas désinstaller pour mettre à jour : une signature incompatible se corrige
en retrouvant le certificat d'origine, pas en effaçant les données. Vérifier
après installation les réglages du hub, l'identité appareil et les files en
attente. Ressaisir le PIN si demandé, puis charger le catalogue en ligne avant
le test hors ligne. La restauration de session après rechargement sans cloud
reste bloquante au relevé du 19 septembre 2026.

La livraison et les réserves de l'APK 1.2 sont consignées dans le
[rapport du 19 septembre 2026](../audits/2026-09-19-audit-waiter-caisse.md).

## Les deux invariants à ne pas casser

1. **`androidScheme: 'http'`** dans `apps/pos/capacitor.config.ts` — c'est ce
   qui lève la règle du contenu mixte et laisse passer le `ws://` du bus LAN.
   Le remettre au défaut (`https`) recrée la panne que l'ADR-029 corrige.
2. **L'adresse du hub est FIXE et nommée** dans
   `apps/pos/android/app/src/main/res/xml/network_security_config.xml`
   (aujourd'hui `192.168.1.92`, le poste de caisse principal). Android
   n'accepte pas de plage d'adresses : si l'adresse du hub change, il faut
   l'éditer ici **et refabriquer l'APK**. Symptôme d'un oubli : tout marche
   en ligne, mais plus rien ne part vers la cuisine en coupure internet —
   sans message d'erreur.

## Ce que ce runbook ne couvre pas (volontairement)

- **Signature de release** : les APK debug sont déjà signées. Toute transition
  vers un certificat de release doit préserver la possibilité de mise à jour
  des appareils existants ; ce runbook ne définit pas cette transition.
- **Mode kiosque** : écarté de la v1 (arbitrage du 2026-08-23).
- **Icône et écran de démarrage aux couleurs de la marque** : l'APK porte
  encore les visuels par défaut de Capacitor.
- **iOS** : ouvert par l'ADR-029, sans engagement de date.
