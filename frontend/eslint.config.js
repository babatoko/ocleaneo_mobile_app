import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'android/**', 'ios/**', 'dev-dist/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  // `essential` et non `recommended` : on veut que le linter signale de vrais
  // défauts (variable morte, clé de v-for manquante, prop inexistante), pas
  // des préférences de mise en forme sur les sauts de ligne des attributs.
  ...pluginVue.configs['flat/essential'],

  // vue-eslint-parser délègue le contenu de <script> à un sous-parseur : sans
  // ceci, il utilise espree par défaut, qui ne comprend pas la syntaxe TS
  // (annotations de type, `as`, etc.) des blocs `<script setup lang="ts">`.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // Le projet est en français et les composants mono-mot (Login, Planning)
      // sont la convention retenue depuis le début.
      'vue/multi-word-component-names': 'off',

      // Un `catch {}` volontairement vide est un choix courant ici (une
      // fonctionnalité de confort qui échoue ne doit pas casser un écran) ;
      // il est toujours accompagné d'un commentaire.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Version TS de la règle : le natif ne comprend pas les types.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // `no-undef` ignore les déclarations de types ambiants (celles d'un
      // plugin, sans import explicite) — il signale par exemple
      // `HTMLIonRefresherElement` (fourni par @ionic/core) comme non défini
      // dans un simple cast `as`, alors que `vue-tsc` (l'étape typecheck,
      // seule autorité fiable ici) le résout très bien. Recommandation
      // officielle de typescript-eslint : laisser TypeScript vérifier ça.
      'no-undef': 'off',

      // `any` explicite reste parfois nécessaire aux frontières (plugins
      // Capacitor sans types, réponses de payload dynamiques) ; le contrat
      // de types utile est sur le domaine métier, pas sur ces bords-là.
      '@typescript-eslint/no-explicit-any': 'off',

      // Faux positif avec Ionic : `slot="start"` est l'attribut natif de
      // projection Shadow DOM des ion-* (ion-buttons, ion-icon...), pas la
      // syntaxe de slot nommé dépréciée de Vue 2 que cette règle vise.
      'vue/no-deprecated-slot-attribute': 'off',
    },
  },

  {
    files: ['**/__tests__/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
];
