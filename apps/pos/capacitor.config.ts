import type { CapacitorConfig } from '@capacitor/cli';

// ADR-029 — empaquetage des tablettes de salle.
//
// Le bundle web n'est pas modifié : Capacitor l'enveloppe, il ne le remplace
// pas. `webDir` pointe la sortie Vite, telle quelle.

const config: CapacitorConfig = {
  appId: 'com.thebreakery.pos',
  appName: 'The Breakery POS',
  webDir: 'dist',

  server: {
    // LE réglage qui justifie tout le chantier — à ne pas « nettoyer ».
    //
    // Depuis Capacitor 6, `androidScheme` vaut `https` par défaut. L'app serait
    // alors servie depuis l'origine `https://localhost`, et le WebView
    // appliquerait la règle du CONTENU MIXTE : une page https ne peut pas
    // ouvrir un `ws://`. Or le bus LAN est exactement cela — `hubWsUrl` dérive
    // `ws://<hub>:3001/ws` du `printerUrl` en remplaçant `http` par `ws`.
    //
    // Emballer l'app en laissant le défaut recréerait donc, à l'identique, la
    // panne que l'ADR-029 cite comme argument décisif du passage au natif : la
    // cuisine ne reçoit plus rien dès qu'internet tombe.
    //
    // `http` ramène l'origine à `http://localhost`, et le `ws://` passe.
    // `localhost` reste une origine de confiance pour Android : le contexte
    // sécurisé est préservé, donc `crypto.randomUUID` (noms de canaux temps
    // réel, uniques par montage) et IndexedDB (file hors-ligne) fonctionnent
    // comme dans le navigateur.
    androidScheme: 'http',
  },

  android: {
    // Le trafic en clair vers le hub LAN n'est PAS autorisé ici : `cleartext`
    // est le réglage de rechargement à chaud du développement, et la doc
    // Capacitor le déconseille en production. L'autorisation vit côté Android,
    // dans `network_security_config.xml`, où elle peut être ÉTROITE — un hôte
    // nommé plutôt que tout le réseau. Voir le fichier généré sous
    // `android/app/src/main/res/xml/`.
    //
    // ADR-029, conséquence 1 : « le faire trop large annulerait le bénéfice de
    // sécurité qu'on vient chercher en passant à HTTPS ».
  },
};

export default config;
