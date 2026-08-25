import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
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
