<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonIcon,
  IonPage,
  IonSpinner,
  onIonViewWillEnter,
  onIonViewWillLeave,
} from '@ionic/vue';
import {
  arrowBackOutline,
  checkmarkCircleOutline,
  copyOutline,
  warningOutline,
} from 'ionicons/icons';
import { provider } from '../../providers';
import { ProviderError, ProviderNetworkError } from '../../providers/DataProvider';
import type { CommissionTagResult } from '../../types/models';
import { NFC } from '@exxili/capacitor-nfc';
import { Capacitor } from '@capacitor/core';
import { isNfcEnabled, isNfcSupported, openNfcSettings, startIosNfcSession } from '../../services/nfc';
import { hapticSuccess } from '../../services/haptics';
import { recordError } from '../../services/errorLog';

/**
 * Commissionner un tag NFC : scan d'une pastille vierge, enregistrement dans
 * le registre central via /tags/commission, numéro retourné à marquer sur la
 * pastille. Écran piloté par le feature flag ocleaneo_tag_commissioning :
 * le backend est le seul vrai verrou (403) — ce composant ne gère que l'UI.
 *
 * Pas de file hors ligne : le numéro de tag vient du serveur (séquence), un
 * numéro généré localement serait faux. Connexion requise.
 */

const router = useRouter();

type Phase = 'idle' | 'reading' | 'sending' | 'result';
const phase = ref<Phase>('idle');
const result = ref<CommissionTagResult | null>(null);
const errorText = ref('');
const nfcReady = ref<boolean | null>(null); // null = inconnu (iOS/web)
const nfcEnabled = ref<boolean | null>(null);
const copied = ref(false);
let copyTimeout: ReturnType<typeof setTimeout> | undefined;
// Événement NFC en cours de traitement — même garde que stores/pointage.ts :
// certains lecteurs Android émettent deux onRead pour un seul passage.
let processing = false;
let listener: { remove: () => void } | undefined;

const canScan = computed(() => phase.value === 'idle' && nfcReady.value !== false);

async function commission(uid: string): Promise<void> {
  if (processing) return;
  processing = true;
  phase.value = 'sending';
  errorText.value = '';
  try {
    result.value = await provider.commissionTag(uid);
    phase.value = 'result';
    hapticSuccess();
  } catch (e) {
    if (e instanceof ProviderError && e.status === 403) {
      // Flag retiré entre-temps (désactivé ou ciblage modifié) : retour
      // accueil + rafraîchissement des flags, l'écran ne doit pas rester.
      await router.replace('/planning');
      return;
    }
    if (e instanceof ProviderNetworkError) {
      errorText.value = 'Connexion requise : le numéro du tag vient du serveur. Réessayez une fois en ligne.';
    } else if (e instanceof ProviderError) {
      errorText.value = e.message;
    } else {
      errorText.value = 'Échec de l\'enregistrement. Réessayez.';
    }
    phase.value = 'idle';
  } finally {
    processing = false;
  }
}

function onTagRead(data: unknown): void {
  const uid = (data as { string?: () => { tagInfo?: { uid?: string } } } | undefined)
    ?.string?.()?.tagInfo?.uid;
  if (!uid) return;
  void commission(uid.replace(/:/g, '').trim());
}

async function scanNow(): Promise<void> {
  if (!canScan.value) return;
  errorText.value = '';
  phase.value = 'reading';
  // Android : la lecture est automatique au premier plan, startScan y
  // échoue systématiquement — on ne l'appelle que sur iOS (session manuelle).
  try {
    await startIosNfcSession();
  } catch (e) {
    phase.value = 'idle';
    void recordError(String((e as Error)?.message || e), 'tag-commissioning: startScan');
    errorText.value = 'Session NFC impossible. Réessayez.';
  }
}

async function refreshNfcState(): Promise<void> {
  nfcReady.value = await isNfcSupported();
  if (nfcReady.value) nfcEnabled.value = await isNfcEnabled();
}

function resetForNext(): void {
  result.value = null;
  phase.value = 'idle';
  copied.value = false;
  void refreshNfcState();
}

async function copyNumber(): Promise<void> {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.name);
    copied.value = true;
    clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Copie indisponible (webview restreinte) : le numéro reste affiché en
    // grand, l'agent peut le recopier à la main — non bloquant.
  }
}

function onWillLeave(): void {
  listener?.remove?.();
  listener = undefined;
}

onMounted(refreshNfcState);
onIonViewWillEnter(async () => {
  if (phase.value !== 'result') await refreshNfcState();
  if (Capacitor.isNativePlatform() && !listener) {
    // Un seul abonnement pendant la vie de l'écran : chaque lecture lance
    // commission() ; le garde `processing` absorbe les doubles évènements.
    const handle = await NFC.onRead(onTagRead);
    listener = handle as unknown as { remove: () => void };
  }
});
onIonViewWillLeave(onWillLeave);
onUnmounted(onWillLeave);
</script>

<template>
  <ion-page>
    <ion-content class="ion-padding tc-content">
      <div class="tc-header">
        <button type="button" class="tc-back" aria-label="Retour" @click="router.back()">
          <ion-icon :icon="arrowBackOutline"></ion-icon>
        </button>
        <h1>Commissionner un tag</h1>
      </div>

      <!-- Résultat : numéro à marquer sur la pastille -->
      <div v-if="phase === 'result' && result" class="tc-result">
        <div class="tc-check" aria-hidden="true">
          <ion-icon :icon="checkmarkCircleOutline"></ion-icon>
        </div>
        <h2>{{ result.existing ? 'Pastille déjà enregistrée' : 'Pastille commissionnée' }}</h2>
        <p v-if="!result.existing" class="tc-sub">Marquez ce numéro sur la pastille avant de la poser sur site.</p>
        <p v-else class="tc-sub tc-sub-warn">
          <ion-icon :icon="warningOutline"></ion-icon>
          Aucune modification — voici sa fiche.
        </p>

        <div class="tc-card" :class="{ existing: result.existing }">
          <p class="tc-label">Numéro du tag</p>
          <p class="tc-number">{{ result.name }}</p>
          <p class="tc-uid">UID {{ result.uid }}</p>
          <button type="button" class="tc-copy" @click="copyNumber">
            <ion-icon :icon="copyOutline"></ion-icon>
            {{ copied ? 'Copié ✓' : 'Copier le numéro' }}
          </button>
          <p class="tc-state">État : {{ result.state === 'draft' ? 'brouillon' : result.state }}</p>
        </div>

        <ion-button expand="block" class="tc-primary" @click="resetForNext">
          Commissionner une autre pastille
        </ion-button>
        <ion-button expand="block" fill="outline" class="tc-outline" @click="router.replace('/planning')">
          Terminer
        </ion-button>
      </div>

      <!-- En attente / erreur NFC -->
      <div v-else class="tc-scan">
        <div class="tc-pulse" :class="{ reading: phase !== 'idle' }" aria-hidden="true">
          <ion-spinner v-if="phase === 'sending'" name="crescent"></ion-spinner>
          <span v-else class="tc-nfc-ico">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M4.5 9a8 8 0 0 1 0 6" />
              <path d="M8 7.5a11 11 0 0 1 0 9" />
              <path d="M11.5 6a14.5 14.5 0 0 1 0 12" />
              <rect x="14.5" y="7" width="7" height="10" rx="2" />
            </svg>
          </span>
        </div>

        <h2 v-if="phase === 'idle'">Approchez la pastille</h2>
        <h2 v-else-if="phase === 'sending'">Enregistrement…</h2>
        <h2 v-else>Session NFC ouverte</h2>

        <p class="tc-help">
          Tenez la pastille contre le dos du téléphone jusqu'à la vibration.
        </p>

        <p v-if="errorText" class="tc-error">{{ errorText }}</p>

        <p v-if="nfcReady === false" class="tc-warn">
          Cet appareil n'a pas de NFC — commissionnez depuis un téléphone équipé.
        </p>
        <p v-else-if="nfcEnabled === false" class="tc-warn">
          Le NFC est désactivé.
          <button type="button" class="tc-link" @click="openNfcSettings">Ouvrir les réglages</button>
        </p>

        <ion-button expand="block" class="tc-primary" :disabled="!canScan" @click="scanNow">
          Scanner maintenant
        </ion-button>
        <p class="tc-note">Connexion requise — le numéro vient du serveur.</p>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.tc-content {
  --background: var(--bg-page);
}
.tc-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 18px;
}
.tc-back {
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
}
.tc-header h1 {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
}
.tc-scan,
.tc-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  max-width: 420px;
  margin: 0 auto;
}
.tc-pulse {
  position: relative;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
}
.tc-pulse.reading::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--accent);
  opacity: 0.3;
  animation: tc-ping 1.6s ease-out infinite;
}
@keyframes tc-ping {
  0% { transform: scale(0.85); opacity: 0.4; }
  100% { transform: scale(1.2); opacity: 0; }
}
.tc-scan h2,
.tc-result h2 {
  font-size: 20px;
  font-weight: 800;
  color: var(--text-primary);
  margin: 0;
}
.tc-help,
.tc-sub {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
  max-width: 280px;
}
.tc-sub-warn {
  color: var(--warn-text);
  font-weight: 600;
}
.tc-warn {
  font-size: 13.5px;
  color: var(--warn-text);
  margin: 0;
}
.tc-error {
  font-size: 13.5px;
  color: var(--danger);
  margin: 0;
}
.tc-link {
  border: none;
  background: transparent;
  color: var(--warn-text);
  text-decoration: underline;
  font-size: 13.5px;
  padding: 0;
}
.tc-note {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 8px;
}
.tc-result .tc-check {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--success-bg);
  color: var(--success-text);
  font-size: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tc-card {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 14px;
  box-shadow: 0 1px 2px rgba(38, 37, 31, 0.05);
}
.tc-card.existing {
  opacity: 0.92;
}
.tc-label {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--text-muted);
  margin: 0;
}
.tc-number {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 40px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--accent-text);
  margin: 6px 0 0;
}
.tc-uid {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12.5px;
  color: var(--text-muted);
  margin: 2px 0 12px;
  word-break: break-all;
}
.tc-copy {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: var(--surface-1);
  border: 1px solid var(--border-strong);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  padding: 9px 16px;
  border-radius: 11px;
}
.tc-state {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin: 12px 0 0;
}
.tc-primary {
  --background: var(--accent);
  --color: var(--on-accent);
  margin-top: 10px;
}
.tc-outline {
  --border-color: var(--accent);
  --color: var(--accent);
}
</style>