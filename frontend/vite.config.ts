import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// Même format que android/app/build.gradle (versionName), pour que la
// version affichée en PWA/navigateur (services/appInfo.ts) reste comparable
// à celle de l'APK plutôt que de basculer sur un format différent.
function buildDateStamp(): string {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}.${parts.month}.${parts.day}-${parts.hour}${parts.minute}`;
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_BUILD_DATE__: JSON.stringify(buildDateStamp()),
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // Sans icônes 192/512, Chrome refuse de proposer l'installation (le
      // critère "manifeste valide" échoue silencieusement) — la PWA restait
      // accessible par navigateur mais jamais installable sur écran d'accueil,
      // malgré ce qu'annonçait le README.
      manifest: {
        name: 'Ocleaneo',
        short_name: 'Ocleaneo',
        description: "Commande produits, inventaire et suivi chantiers pour les salariés d'Ocleaneo",
        lang: 'fr',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Sans ça, Rollup regroupe @ionic/core (le plus gros morceau du bundle,
        // le runtime de composants — pas "nos" providers) dans un chunk nommé
        // d'après le premier module qu'il croise dans le graphe d'imports :
        // `providers-*.js`, un nom qui n'a rien à voir avec son contenu et
        // gênait le diagnostic de poids du bundle. Isoler ce runtime dans son
        // propre chunk stable a aussi un vrai bénéfice de cache : il ne change
        // pas d'une release à l'autre, contrairement au code applicatif.
        manualChunks(id: string) {
          if (/node_modules\/(@ionic|ionicons)\//.test(id)) return 'ionic';
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
})
