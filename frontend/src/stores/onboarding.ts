import { defineStore } from 'pinia';
import { ONBOARDING_STEPS } from '../data/onboardingSteps';
import { hasTourBeenSeen, markTourSeen } from '../services/onboarding';
import { useAuthStore } from './auth';

interface OnboardingState {
  active: boolean;
  step: number;
}

export const useOnboardingStore = defineStore('onboarding', {
  state: (): OnboardingState => ({
    active: false,
    step: 0,
  }),
  actions: {
    /** À appeler quand l'employé courant est (re)connu — voir App.vue. Ne
     *  démarre le tour que s'il n'a encore jamais été vu sur cet appareil. */
    async maybeStartForCurrentEmployee(): Promise<void> {
      const { employee } = useAuthStore();
      if (!employee) return;
      const seen = await hasTourBeenSeen(employee.id);
      if (!seen) this.start();
    },
    /** Rejoue le tour à la demande (bouton « Revoir le tour guidé » de
     *  AideView) — sans toucher au drapeau, déjà à true à ce stade. */
    start(): void {
      this.step = 0;
      this.active = true;
    },
    next(): void {
      if (this.step < ONBOARDING_STEPS.length - 1) {
        this.step += 1;
      } else {
        this.finish();
      }
    },
    prev(): void {
      if (this.step > 0) this.step -= 1;
    },
    /** Ferme le tour, qu'il ait été terminé ou passé, et marque l'employé
     *  courant comme l'ayant vu. */
    async finish(): Promise<void> {
      this.active = false;
      const { employee } = useAuthStore();
      if (employee) await markTourSeen(employee.id);
    },
  },
});
