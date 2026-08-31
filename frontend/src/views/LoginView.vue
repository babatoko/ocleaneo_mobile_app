<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonButton, IonContent, IonIcon, IonInput, IonLabel, IonPage, IonSegment, IonSegmentButton, IonSpinner, alertController, toastController } from '@ionic/vue';
import { fingerPrintOutline, lockClosedOutline, serverOutline, sparklesOutline } from 'ionicons/icons';
import { useAuthStore } from '../stores/auth';
import { usePointageStore } from '../stores/pointage';
import { useServerUrl } from '../composables/useServerUrl';
import { PROVIDER_KIND_LABELS, PROVIDER_KINDS, useProviderKind } from '../composables/useProviderKind';
import type { ProviderKind } from '../providers';
import { ProviderNetworkError, ProviderError } from '../providers/DataProvider';
import {
  clearSavedCredentials,
  getSavedCredentials,
  hasSavedCredentials,
  isBiometricAvailable,
  saveCredentials,
} from '../services/biometric';
import { recordError } from '../services/errorLog';

const LAST_USERNAME_KEY = 'ocleaneo_last_username';
const BIOMETRIC_DECLINED_KEY = 'ocleaneo_biometric_declined';

const mode = ref('password'); // 'password' | 'biometric'
const username = ref('');
const password = ref('');
const rememberedUsername = ref('');
const error = ref('');
const loading = ref(false);
const biometricAvailable = ref(false);

const auth = useAuthStore();
const pointage = usePointageStore();
const router = useRouter();
const route = useRoute();

// Avant cet écran, changer l'URL du serveur exigeait d'être déjà connecté
// (ProfileView.vue, seul écran protégé accessible) — un salarié dont le
// téléphone pointe vers la mauvaise instance n'avait donc aucun moyen de le
// corriger : il ne pouvait ni se connecter (mauvais serveur), ni atteindre
// le réglage qui l'aurait permis (réservé aux salariés déjà connectés).
const serverPanelOpen = ref(false);
const {
  defaultServerUrl,
  currentServerUrl,
  serverUrlInput,
  serverUrlError,
  savingServerUrl,
  showServerSetting,
  serverUrlOverridden,
  serverUrlChanged,
  saveServerUrl: saveServerUrlValue,
  resetServerUrl: resetServerUrlValue,
} = useServerUrl();

// Le backend actif (odoo/rest/mock) était jusqu'ici figé à la construction
// de l'app (VITE_DATA_PROVIDER, voir .env.example) : rien dans l'app ne
// permettait de le corriger sans reconstruire — exactement l'impasse que le
// panneau « Configurer le serveur » comble déjà pour l'URL.
const { providerKind, savingProviderKind, selectProviderKind } = useProviderKind();

function toggleServerPanel() {
  serverPanelOpen.value = !serverPanelOpen.value;
  error.value = '';
}

async function changeProviderKind(event: CustomEvent) {
  const kind = event.detail.value as ProviderKind;
  await selectProviderKind(kind);
}

async function saveServerUrl() {
  if (await saveServerUrlValue()) serverPanelOpen.value = false;
}

async function resetServerUrl() {
  await resetServerUrlValue();
}

onMounted(async () => {
  // Même raisonnement que maybeOfferBiometric() ci-dessous : on fait
  // confiance au plugin NativeBiometric pour échouer proprement (try/catch
  // dans getSavedCredentials()) si la biométrie n'est pas réellement
  // disponible, plutôt que de court-circuiter sur un isAvailable() qui
  // renvoie false sur certains appareils pourtant fonctionnels.
  biometricAvailable.value = await isBiometricAvailable() || (await hasSavedCredentials());
  rememberedUsername.value = localStorage.getItem(LAST_USERNAME_KEY) || '';

  if (biometricAvailable.value && (await hasSavedCredentials())) {
    mode.value = 'biometric';
    tryBiometric();
  }
});

// Un échec de connexion a trois causes très différentes pour le salarié : pas
// de réseau (fréquent en sous-sol/local technique), mauvais identifiants, ou
// serveur en panne. Les confondre sous « Identifiants incorrects » envoie
// l'agent retaper un mot de passe correct.
function loginErrorMessage(e: unknown): string {
  if (e instanceof ProviderNetworkError) return 'Pas de connexion — vérifiez votre réseau puis réessayez.';
  if (e instanceof ProviderError && (e.status === 401 || e.status === 403)) return 'Identifiants incorrects.';
  return e instanceof Error ? e.message || 'Connexion impossible pour le moment.' : 'Connexion impossible pour le moment.';
}

async function afterLogin(loggedInUsername: string) {
  localStorage.setItem(LAST_USERNAME_KEY, loggedInUsername);
  if (pointage.pendingTagUid) {
    // L'app vient d'être ouverte par ce badge : on traite la lecture en
    // attente au lieu d'atterrir sur le planning.
    await pointage.consumePendingTag(router);
    return;
  }
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/planning';
  router.replace(redirect);
}

async function tryBiometric() {
  error.value = '';
  loading.value = true;
  try {
    const creds = await getSavedCredentials();
    await auth.login(creds.username, creds.password);
    await afterLogin(creds.username);
  } catch (e) {
    // Le réseau peut tomber après une empreinte pourtant valide : ne pas
    // laisser croire que le capteur a échoué.
    if (e instanceof ProviderNetworkError) {
      error.value = loginErrorMessage(e);
      void recordError(
        `URL serveur : "${currentServerUrl.value ?? defaultServerUrl.value}" — ${e.message}`,
        'LoginView.tryBiometric: échec de connexion',
      );
    } else {
      error.value = "Authentification par empreinte annulée ou impossible.";
    }
  } finally {
    loading.value = false;
  }
}

function usePassword() {
  mode.value = 'password';
  username.value = rememberedUsername.value;
  error.value = '';
}

async function forgetBiometric() {
  await clearSavedCredentials();
  usePassword();
}

/**
 * Propose l'activation de la biométrie plutôt que de sauvegarder le mot de
 * passe sans le dire : sans ce consentement explicite, chaque connexion au
 * mot de passe enregistrait silencieusement les identifiants dans le
 * trousseau natif. On ne le redemande pas si le salarié a déjà refusé une
 * fois (`BIOMETRIC_DECLINED_KEY`) ni s'il a déjà des identifiants enregistrés.
 */
async function maybeOfferBiometric(loggedInUsername: string, loggedInPassword: string) {
  // Sur certains appareils (OnePlus notamment), NativeBiometric.isAvailable()
  // renvoie false malgré une empreinte fonctionnelle — sans doute parce que
  // l'appareil n'expose pas KeyManager.isDeviceSecure() comme attendu. On
  // force l'invite et on laisse saveCredentials() décider si la sauvegarde
  // fonctionne réellement ; si elle échoue silencieusement (try/catch dans
  // services/biometric.ts), hasSavedCredentials() restera faux et la prochaine
  // ouverture retombera sur l'écran mot de passe, sans régression visible.
  if (localStorage.getItem(BIOMETRIC_DECLINED_KEY) === '1') return;
  if (await hasSavedCredentials()) return;

  const alert = await alertController.create({
    header: 'Connexion par empreinte ?',
    message: 'Activez-la pour vous reconnecter plus vite la prochaine fois, sans retaper votre mot de passe. On vous demandera votre empreinte pour confirmer.',
    buttons: [
      {
        text: 'Non merci',
        role: 'cancel',
        handler: () => localStorage.setItem(BIOMETRIC_DECLINED_KEY, '1'),
      },
      {
        text: 'Activer',
        handler: async () => {
          const ok = await saveCredentials(loggedInUsername, loggedInPassword);
          if (!ok) {
            // Pas de prompt natif affiché, ou échec capteur : l'utilisateur
            // ne sait pas que rien n'a été enregistré. On le dit, sinon il
            // croit avoir activé la biométrie et se retrouve à devoir
            // ressaisir ses identifiants au prochain lancement.
            const toast = await toastController.create({
              message: "Impossible d'activer la biométrie sur cet appareil.",
              duration: 3000,
              color: 'warning',
            });
            await toast.present();
          }
        },
      },
    ],
  });
  await alert.present();
  await alert.onDidDismiss();
}

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    await maybeOfferBiometric(username.value, password.value);
    await afterLogin(username.value);
  } catch (e) {
    error.value = loginErrorMessage(e);
    // Ce catch avale l'erreur (elle ne devient jamais un rejet non
    // rattrapé), donc installErrorHandlers() ne la voit jamais — sans ce
    // log explicite, un échec de connexion ne laisse aucune trace
    // exploitable au-delà du message générique affiché à l'écran.
    void recordError(
      `URL serveur : "${currentServerUrl.value ?? defaultServerUrl.value}" — ${e instanceof Error ? e.message : String(e)}`,
      'LoginView.submit: échec de connexion',
    );
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <ion-page>
    <ion-content class="ion-padding" :fullscreen="true">
      <div class="login-screen">
        <div class="login-logo"><ion-icon :icon="sparklesOutline"></ion-icon></div>

        <template v-if="mode === 'biometric'">
          <p class="login-title">Bonjour</p>
          <p class="login-sub">Connectez-vous pour continuer</p>

          <button class="fingerprint-circle" type="button" :disabled="loading" @click="tryBiometric">
            <ion-spinner v-if="loading" name="crescent"></ion-spinner>
            <ion-icon v-else :icon="fingerPrintOutline"></ion-icon>
          </button>
          <p class="login-hint">Posez votre doigt sur le capteur</p>
          <p class="login-name">{{ rememberedUsername }}</p>

          <button class="login-alt" type="button" @click="usePassword">
            <ion-icon :icon="lockClosedOutline"></ion-icon> Utiliser le mot de passe
          </button>
          <button class="login-alt" type="button" @click="forgetBiometric">Ce n'est pas vous ?</button>
        </template>

        <template v-else>
          <p class="login-title">Bonjour</p>
          <p class="login-sub">Connectez-vous avec vos identifiants</p>

          <form class="login-form" @submit.prevent="submit">
            <ion-input
              v-model="username"
              fill="outline"
              label="Identifiant"
              label-placement="floating"
              autocapitalize="none"
              autocomplete="username"
              required
            ></ion-input>
            <ion-input
              v-model="password"
              type="password"
              fill="outline"
              label="Mot de passe"
              label-placement="floating"
              autocomplete="current-password"
              required
            ></ion-input>
            <ion-button type="submit" expand="block" :disabled="loading">
              <ion-spinner v-if="loading" name="crescent"></ion-spinner>
              <template v-else>Se connecter</template>
            </ion-button>
          </form>

          <p v-if="biometricAvailable" class="login-alt">
            <ion-icon :icon="fingerPrintOutline"></ion-icon> On vous proposera d'activer la connexion par empreinte après la connexion
          </p>
        </template>

        <p v-if="error" class="error">{{ error }}</p>

        <button class="login-alt server-toggle" type="button" @click="toggleServerPanel">
          <ion-icon :icon="serverOutline"></ion-icon>
          {{ serverPanelOpen ? 'Fermer' : 'Configurer le serveur' }}
        </button>

        <div v-if="serverPanelOpen" class="server-url-field">
          <ion-segment
            :value="providerKind || 'odoo'"
            :disabled="savingProviderKind"
            @ion-change="changeProviderKind"
          >
            <ion-segment-button v-for="kind in PROVIDER_KINDS" :key="kind" :value="kind">
              <ion-label>{{ PROVIDER_KIND_LABELS[kind] }}</ion-label>
            </ion-segment-button>
          </ion-segment>

          <template v-if="showServerSetting">
            <ion-input
              v-model="serverUrlInput"
              type="url"
              inputmode="url"
              fill="outline"
              placeholder="https://exemple.odoo.com"
              autocapitalize="none"
              autocomplete="off"
            ></ion-input>
            <p class="server-url-sub">
              Valeur par défaut : {{ defaultServerUrl }}
              <template v-if="serverUrlOverridden"> · personnalisée actuellement</template>
            </p>
            <p v-if="serverUrlError" class="server-url-error">{{ serverUrlError }}</p>
            <div class="server-url-actions">
              <ion-button
                class="server-url-save"
                expand="block"
                :disabled="!serverUrlChanged || savingServerUrl"
                @click="saveServerUrl"
              >
                Enregistrer
              </ion-button>
              <ion-button
                v-if="serverUrlOverridden"
                class="server-url-reset"
                fill="clear"
                :disabled="savingServerUrl"
                @click="resetServerUrl"
              >
                Revenir à la valeur par défaut
              </ion-button>
            </div>
          </template>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.login-form ion-input {
  --background: var(--surface-2);
  --border-color: var(--border);
  --border-radius: 10px;
  --color: var(--text-primary);
  --padding-start: 14px;
  --padding-end: 14px;
}

.login-form ion-button {
  margin-top: 4px;
  --background: var(--accent);
  --color: var(--on-accent);
  --border-radius: 10px;
  --box-shadow: none;
  font-weight: 500;
  text-transform: none;
}

.error {
  color: var(--danger);
  font-size: 13px;
  margin-top: 16px;
}

.server-toggle {
  margin-top: 24px;
}

.server-url-field {
  width: 100%;
  padding: 12px 0 0;
}

.server-url-field ion-input {
  --background: var(--surface-2);
  --border-color: var(--border);
  --border-radius: 10px;
  --color: var(--text-primary);
  --padding-start: 14px;
  --padding-end: 14px;
}

.server-url-field ion-segment {
  margin-bottom: 12px;
}

.server-url-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 6px 0 0;
}

.server-url-error {
  color: var(--danger);
  font-size: 11px;
  margin: 6px 0 0;
}

.server-url-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.server-url-save {
  --border-radius: 10px;
  --background: var(--accent);
  --color: var(--on-accent);
  --box-shadow: none;
  font-weight: 500;
  font-size: 13px;
  text-transform: none;
  margin: 0;
}

.server-url-reset {
  --color: var(--text-secondary);
  font-size: 12px;
  text-decoration: underline;
  margin: 0;
}
</style>
