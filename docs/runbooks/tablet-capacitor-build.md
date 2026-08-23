# Runbook — fabriquer et installer l'application tablette (Capacitor)

> Périmètre : la coquille Android de la tablette de salle (ADR-029). Le code
> applicatif est le bundle web du POS, embarqué tel quel dans l'APK
> (arbitrage du 2026-08-23 : bundle embarqué, pas de chargement distant).
> Une mise à jour de l'application = refabriquer l'APK et le réinstaller.

## Ce qu'il faut sur le poste de fabrication

| Outil | Version | Où |
|---|---|---|
| JDK | 21 (Temurin) | `C:\Program Files\Eclipse Adoptium\jdk-21*` |
| SDK Android | platform-tools + platforms;android-35 + build-tools;35.0.0 | `%LOCALAPPDATA%\Android\Sdk` |
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
$env:JAVA_HOME = (Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-21*")[0].FullName
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

Sortie : `apps/pos/android/app/build/outputs/apk/debug/app-debug.apk`.

## Installer sur la tablette

Activer le débogage USB sur la tablette (Options développeur), la brancher,
puis :

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r apps/pos/android/app/build/outputs/apk/debug/app-debug.apk
```

Sans câble : copier l'APK sur la tablette (lien de partage, clé USB) et
l'ouvrir — Android demandera d'autoriser l'installation d'origine inconnue.
L'application s'appelle **The Breakery POS** (`com.thebreakery.pos`,
arbitrage du 2026-08-23 : identité du socle conservée) et démarre sur
l'écran tablette de salle (`/tablet`).

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

- **APK signé de release** : la debug suffit pour l'installation manuelle en
  boutique. La signature viendra si la distribution change.
- **Mode kiosque** : écarté de la v1 (arbitrage du 2026-08-23).
- **Icône et écran de démarrage aux couleurs de la marque** : l'APK porte
  encore les visuels par défaut de Capacitor.
- **iOS** : ouvert par l'ADR-029, sans engagement de date.
