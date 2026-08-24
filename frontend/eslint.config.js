import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'android/**', 'ios/**', 'dev-dist/**', 'node_modules/**'] },

  js.configs.recommended,
  // `essential` et non `recommended` : on veut que le linter signale de vrais
  // défauts (variable morte, clé de v-for manquante, prop inexistante), pas
  // des préférences de mise en forme sur les sauts de ligne des attributs.
  ...pluginVue.configs['flat/essential'],

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

      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  {
    files: ['**/__tests__/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
