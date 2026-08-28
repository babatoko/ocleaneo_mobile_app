import { computed, ref, watch } from 'vue';
import { provider, providerKind } from '../providers';

/**
 * État et logique de l'écran « Serveur » — extrait de ProfileView.vue pour
 * être réutilisé depuis LoginView.vue : un salarié dont le téléphone pointe
 * vers la mauvaise instance doit pouvoir corriger l'URL AVANT de se
 * connecter, pas seulement depuis les réglages (qui exigent d'être déjà
 * authentifié pour y accéder — voir router/guard.ts, seule /login est
 * publique).
 *
 * Ne déclenche PAS de déconnexion : ProfileView.vue a une session à clore
 * après un changement d'URL, LoginView.vue n'en a aucune. Cette décision
 * reste à la charge de l'appelant.
 */
export function useServerUrl() {
  const defaultServerUrl = ref(provider.getDefaultServerUrl());
  const currentServerUrl = ref(provider.getServerUrl());
  const serverUrlInput = ref(currentServerUrl.value || '');
  const serverUrlError = ref('');
  const savingServerUrl = ref(false);

  // Le provider actif peut changer sous nos pieds (useProviderKind.ts,
  // utilisé dans le même écran) : resynchronise sur le nouveau backend
  // plutôt que de continuer à afficher l'URL de l'ancien.
  watch(providerKind, () => {
    defaultServerUrl.value = provider.getDefaultServerUrl();
    currentServerUrl.value = provider.getServerUrl();
    serverUrlInput.value = currentServerUrl.value || '';
    serverUrlError.value = '';
  });

  const showServerSetting = computed(() => currentServerUrl.value !== null);
  const serverUrlOverridden = computed(() => currentServerUrl.value !== defaultServerUrl.value);
  const serverUrlChanged = computed(() => serverUrlInput.value.trim().replace(/\/+$/, '') !== currentServerUrl.value);

  function isValidUrl(value: string) {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function saveServerUrl(): Promise<boolean> {
    const next = serverUrlInput.value.trim();
    serverUrlError.value = '';
    if (!isValidUrl(next)) {
      serverUrlError.value = 'URL invalide (doit commencer par http:// ou https://).';
      return false;
    }
    savingServerUrl.value = true;
    try {
      await provider.setServerUrl(next);
    } finally {
      savingServerUrl.value = false;
    }
    currentServerUrl.value = provider.getServerUrl();
    return true;
  }

  async function resetServerUrl(): Promise<void> {
    savingServerUrl.value = true;
    try {
      await provider.setServerUrl('');
    } finally {
      savingServerUrl.value = false;
    }
    currentServerUrl.value = provider.getServerUrl();
    serverUrlInput.value = currentServerUrl.value || '';
  }

  return {
    defaultServerUrl,
    currentServerUrl,
    serverUrlInput,
    serverUrlError,
    savingServerUrl,
    showServerSetting,
    serverUrlOverridden,
    serverUrlChanged,
    isValidUrl,
    saveServerUrl,
    resetServerUrl,
  };
}
