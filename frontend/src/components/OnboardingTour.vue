<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ONBOARDING_STEPS } from '../data/onboardingSteps';
import { useOnboardingStore } from '../stores/onboarding';
import { bubbleBottom, clampTailX, spotlightRect } from '../utils/tour';

const store = useOnboardingStore();
const step = computed(() => ONBOARDING_STEPS[store.step]);

const spotlightStyle = ref<{ left: string; top: string; width: string; height: string }>({
  left: '0px',
  top: '0px',
  width: '0px',
  height: '0px',
});
const bubbleBottomPx = ref(96);
const tailX = ref('50%');

/**
 * Mesurée, pas devinée : la hauteur de la barre de navigation varie avec la
 * safe-area (voir style.css, .bottom-nav), et sa largeur est plafonnée à
 * 480px puis centrée — reproduire ce calcul ici serait le dupliquer et le
 * désynchroniser au premier changement de l'un des deux fichiers.
 */
function measure(): void {
  const target = document.querySelector<HTMLElement>(`.bottom-nav .nav-item[data-route="${step.value.route}"]`);
  const nav = document.querySelector<HTMLElement>('.bottom-nav');
  if (!target || !nav) return;

  const t = target.getBoundingClientRect();
  const n = nav.getBoundingClientRect();
  const spot = spotlightRect(t);

  spotlightStyle.value = {
    left: `${spot.left}px`,
    top: `${spot.top}px`,
    width: `${spot.width}px`,
    height: `${spot.height}px`,
  };
  bubbleBottomPx.value = bubbleBottom(n.top, window.innerHeight);
  tailX.value = `${clampTailX(t.left + t.width / 2, window.innerWidth)}px`;
}

watch(() => store.step, () => nextTick(measure));
watch(
  () => store.active,
  (active) => {
    if (active) nextTick(measure);
  },
);

onMounted(() => {
  window.addEventListener('resize', measure);
  if (store.active) nextTick(measure);
});
onBeforeUnmount(() => window.removeEventListener('resize', measure));
</script>

<template>
  <div
    v-if="store.active"
    class="tour-root"
    role="dialog"
    aria-modal="true"
    :aria-label="`Tour guidé, étape ${store.step + 1} sur ${ONBOARDING_STEPS.length}`"
  >
    <!-- Capte les taps sur la zone assombrie (le fondu lui-même vient de
         l'ombre portée de .tour-spotlight, qui ne reçoit pas d'événements) et
         avance d'une étape, comme le bouton Suivant. -->
    <button type="button" class="tour-catch" aria-hidden="true" tabindex="-1" @click="store.next()"></button>

    <div class="tour-spotlight" :style="spotlightStyle"></div>

    <div class="tour-bubble" :style="{ bottom: `${bubbleBottomPx}px`, '--tail-x': tailX }">
      <p class="tour-eyebrow">Bienvenue</p>
      <h3>{{ step.title }}</h3>
      <p class="tour-text">{{ step.text }}</p>
      <div class="tour-foot">
        <div class="tour-dots">
          <i v-for="(s, i) in ONBOARDING_STEPS" :key="s.key" :class="{ on: i === store.step }"></i>
        </div>
        <div class="tour-actions">
          <button type="button" class="tour-skip" @click="store.finish()">Passer</button>
          <button type="button" class="tour-next" @click="store.next()">
            {{ store.step === ONBOARDING_STEPS.length - 1 ? 'Terminer' : 'Suivant' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour-root {
  position: fixed;
  inset: 0;
  z-index: 9990;
}

.tour-catch {
  position: fixed;
  inset: 0;
  z-index: 9990;
  border: none;
  padding: 0;
  background: transparent;
  -webkit-tap-highlight-color: transparent;
}

.tour-spotlight {
  position: fixed;
  z-index: 9991;
  border-radius: 16px;
  pointer-events: none;
  box-shadow: 0 0 0 3000px rgba(10, 14, 10, 0.62);
  transition:
    left 0.32s cubic-bezier(0.4, 0, 0.2, 1),
    top 0.32s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.32s,
    height 0.32s;
}

.tour-bubble {
  position: fixed;
  z-index: 9992;
  left: 16px;
  right: 16px;
  max-width: 448px;
  margin-inline: auto;
  background: var(--surface-2);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.18);
  transition: bottom 0.32s cubic-bezier(0.4, 0, 0.2, 1);
}

.tour-bubble::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: calc(var(--tail-x, 50%) - 8px);
  width: 16px;
  height: 16px;
  background: var(--surface-2);
  transform: rotate(45deg);
  border-radius: 3px;
  transition: left 0.32s cubic-bezier(0.4, 0, 0.2, 1);
}

.tour-eyebrow {
  margin: 0;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.tour-bubble h3 {
  margin: 6px 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.tour-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.tour-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.tour-dots {
  display: flex;
  gap: 5px;
}

.tour-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
  display: block;
  transition: width 0.2s;
}

.tour-dots i.on {
  background: var(--accent);
  width: 16px;
  border-radius: 3px;
}

.tour-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.tour-skip {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
}

.tour-next {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--on-accent);
  background: var(--accent);
  border: none;
  border-radius: 9px;
  padding: 8px 16px;
  cursor: pointer;
}

.tour-skip:focus-visible,
.tour-next:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
