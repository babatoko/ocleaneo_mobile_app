<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonCheckbox,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonTextarea,
} from '@ionic/vue';
import { checkmarkDoneOutline, documentTextOutline } from 'ionicons/icons';
import { usePointageStore } from '../../stores/pointage';
import AppHeader from '../../components/AppHeader.vue';

const router = useRouter();
const pointage = usePointageStore();

// Le premier de la liste : s'il y en a plusieurs (deux départs enchaînés
// avant d'avoir traité le premier compte-rendu), les suivants restent
// affichés au bandeau de PointageView jusqu'à leur tour.
const current = computed(() => pointage.pendingCompteRendus[0] ?? null);

const commentaire = ref('');
const checked = ref<Record<number, boolean>>({});
const submitting = ref(false);

watch(
  current,
  (c) => {
    commentaire.value = '';
    checked.value = {};
    if (c) {
      for (const activity of c.activities) checked.value[activity.id] = activity.completed;
    } else {
      // Plus rien à traiter (dernier compte-rendu venant d'être soumis, ou
      // écran ouvert directement sans départ en attente) : rien à faire ici,
      // pas de retour forcé — voir PointageView, dont le bandeau de rappel
      // est la seule porte d'entrée normale vers cet écran.
      router.push({ name: 'pointage' });
    }
  },
  { immediate: true },
);

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function submit() {
  if (!current.value || !commentaire.value.trim() || submitting.value) return;
  submitting.value = true;
  try {
    const activities = current.value.activities.map((a) => ({
      id: a.id,
      completed: !!checked.value[a.id],
    }));
    await pointage.submitCompteRendu(current.value.clientRef, commentaire.value.trim(), activities);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ion-page>
    <AppHeader title="Compte-rendu de fin de chantier" />
    <ion-content v-if="current">
      <div class="cr-context">
        <p class="cr-chantier">{{ current.chantierName }}</p>
        <p class="cr-duration">Départ à {{ fmtTime(current.recordedAt) }}</p>
      </div>

      <template v-if="current.activities.length">
        <p class="section-title">
          <ion-icon :icon="checkmarkDoneOutline"></ion-icon> Activités à valider
        </p>
        <ion-list class="activities-list" lines="full">
          <ion-item v-for="activity in current.activities" :key="activity.id">
            <ion-checkbox
              slot="start"
              :checked="!!checked[activity.id]"
              @ion-change="checked[activity.id] = $event.detail.checked"
            ></ion-checkbox>
            <ion-label class="ion-text-wrap" :class="{ 'activity-done': checked[activity.id] }">
              {{ activity.name }}
              <span v-if="activity.required" class="activity-required">obligatoire</span>
            </ion-label>
          </ion-item>
        </ion-list>
      </template>
      <div v-else class="cr-empty">
        <ion-icon :icon="checkmarkDoneOutline"></ion-icon>
        <p>Aucune activité prévue pour ce chantier — décrivez le travail réalisé ci-dessous.</p>
      </div>

      <p class="section-title">
        <ion-icon :icon="documentTextOutline"></ion-icon> Compte-rendu <span class="required-mark">*</span>
      </p>
      <div class="cr-textarea-wrap">
        <ion-textarea
          v-model="commentaire"
          placeholder="Décrivez le travail réalisé, un incident ou une info pour le prochain passage…"
          :rows="current.activities.length ? 4 : 8"
          :maxlength="2000"
          auto-grow
        ></ion-textarea>
      </div>
    </ion-content>

    <div v-if="current" class="cr-cta-bar">
      <ion-button expand="block" :disabled="!commentaire.trim() || submitting" @click="submit">
        Valider
      </ion-button>
      <p v-if="current.activities.length" class="cr-cta-hint">
        Les activités obligatoires non cochées seront signalées à votre responsable.
      </p>
    </div>
  </ion-page>
</template>

<style scoped>
.cr-context {
  padding: 16px 18px 0;
}

.cr-chantier {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.cr-duration {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 4px 0 0;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 16px 0 4px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
}

.section-title ion-icon {
  font-size: 15px;
  color: var(--text-secondary);
}

.required-mark {
  color: var(--danger);
  font-weight: 700;
}

.activities-list {
  margin: 0 4px;
  background: transparent;
}

.activity-done {
  text-decoration: line-through;
  color: var(--text-secondary);
}

.activity-required {
  display: inline-block;
  margin-left: 6px;
  font-size: 10px;
  font-weight: 500;
  color: var(--warn-text);
  text-transform: uppercase;
}

.cr-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 18px;
  background: var(--surface-1);
  border-radius: 10px;
  padding: 12px 14px;
}

.cr-empty ion-icon {
  font-size: 20px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.cr-empty p {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin: 0;
}

.cr-textarea-wrap {
  margin: 0 18px;
  background: var(--surface-1);
  border-radius: 10px;
  padding: 4px 12px;
}

.cr-cta-bar {
  flex-shrink: 0;
  background: var(--surface-2);
  border-top: 0.5px solid var(--border);
  padding: 12px 18px calc(14px + env(safe-area-inset-bottom));
}

.cr-cta-hint {
  font-size: 10.5px;
  color: var(--text-muted);
  margin: 8px 0 0;
  text-align: center;
}
</style>
