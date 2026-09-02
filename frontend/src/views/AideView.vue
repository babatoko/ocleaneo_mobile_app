<script setup lang="ts">
import { IonAccordion, IonAccordionGroup, IonContent, IonIcon, IonItem, IonLabel, IonPage } from '@ionic/vue';
import { chevronForwardOutline, refreshOutline } from 'ionicons/icons';
import AppHeader from '../components/AppHeader.vue';
import { ONBOARDING_STEPS } from '../data/onboardingSteps';
import { useOnboardingStore } from '../stores/onboarding';

const onboarding = useOnboardingStore();
</script>

<template>
  <ion-page>
    <AppHeader title="Centre d'aide" />
    <ion-content>
      <button type="button" class="hero-row" @click="onboarding.start()">
        <span class="hero-chip"><ion-icon :icon="refreshOutline" aria-hidden="true"></ion-icon></span>
        <span class="hero-txt">
          <b>Revoir le tour guidé</b>
          <span>{{ ONBOARDING_STEPS.length }} étapes · environ 30 secondes</span>
        </span>
        <ion-icon class="hero-go" :icon="chevronForwardOutline" aria-hidden="true"></ion-icon>
      </button>

      <p class="section-label">Manuel d'utilisation</p>
      <ion-accordion-group class="manual-list">
        <ion-accordion v-for="s in ONBOARDING_STEPS" :key="s.key" :value="s.key">
          <ion-item slot="header" lines="full">
            <span class="sec-icn"><ion-icon :icon="s.icon" aria-hidden="true"></ion-icon></span>
            <ion-label class="ion-text-wrap">{{ s.title }}</ion-label>
          </ion-item>
          <div class="sec-body" slot="content">{{ s.text }}</div>
        </ion-accordion>
      </ion-accordion-group>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.hero-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - 32px);
  margin: 16px 16px 0;
  padding: 12px 12px 12px 13px;
  background: var(--accent-bg);
  border: 1px solid var(--accent);
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}

.hero-chip {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-chip ion-icon {
  font-size: 18px;
}

.hero-txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.hero-txt b {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--accent-text);
}

.hero-txt span {
  font-size: 11.5px;
  color: var(--accent-text);
  opacity: 0.75;
  margin-top: 1px;
}

.hero-go {
  font-size: 15px;
  color: var(--accent);
  flex-shrink: 0;
}

.section-label {
  margin: 22px 16px 7px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.manual-list {
  margin: 0 16px;
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface-2);
}

.sec-icn {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--surface-1);
  color: var(--text-secondary);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-inline-end: 12px;
}

.sec-icn ion-icon {
  font-size: 16px;
}

.sec-body {
  padding: 0 16px 14px 58px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-secondary);
  background: var(--surface-1);
}
</style>
