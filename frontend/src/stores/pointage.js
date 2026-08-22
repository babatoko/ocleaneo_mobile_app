import { defineStore } from 'pinia';
import { Capacitor } from '@capacitor/core';
import { NFC } from '@exxili/capacitor-nfc';
import { api } from '../services/api';
import { useAuthStore } from './auth';
import { useChantiersStore } from './chantiers';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 3000 }
    );
  });
}

// Un seul abonnement NFC pour toute la durée de vie de l'app : un badge peut être
// lu à tout moment (Android relance même l'app depuis fermée), pas seulement quand
// l'écran Pointage est ouvert.
let listenersReady = false;

export const usePointageStore = defineStore('pointage', {
  state: () => ({
    entries: [],
    todayShifts: [],
    status: 'out', // 'in' | 'out', dernier pointage du jour tous chantiers confondus
    scanning: false,
    scanError: '',
    pendingTagUid: null, // badge lu avant que le salarié soit authentifié
  }),
  getters: {
    lastEntry: (state) => state.entries[state.entries.length - 1],
  },
  actions: {
    async load() {
      const [{ data: shiftsData }, { data: entriesData }] = await Promise.all([
        api.get('/shifts/mine', { params: { from: todayIso(), to: todayIso() } }),
        api.get('/time-entries/today'),
      ]);
      this.todayShifts = shiftsData;
      this.entries = entriesData.entries;
      this.status = entriesData.status;
    },

    async clockWithTag(uid) {
      this.scanError = '';
      const chantiers = useChantiersStore();
      if (!chantiers.list.length) await chantiers.fetchMine();
      const chantier = chantiers.list.find(
        (c) => c.nfc_tag_id && c.nfc_tag_id.toLowerCase() === uid.toLowerCase()
      );
      if (!chantier) {
        this.scanError = 'Badge non reconnu. Contactez votre responsable.';
        return;
      }

      await this.load();
      const position = await getPosition();
      const lastForChantier = [...this.entries].reverse().find((e) => e.chantier_id === chantier.id);
      const shift = this.todayShifts.find((s) => s.chantier_id === chantier.id);

      await api.post('/time-entries', {
        chantierId: chantier.id,
        shiftId: shift?.id,
        type: lastForChantier?.type === 'in' ? 'out' : 'in',
        ...position,
      });
      await this.load();
    },

    initGlobalListener(router) {
      if (listenersReady || !Capacitor.isNativePlatform()) return;
      listenersReady = true;

      NFC.onRead((data) => {
        const uid = data.string()?.tagInfo?.uid;
        if (uid) this.handleTagRead(uid, router);
      });
      NFC.onError((err) => {
        this.scanError = err.error || 'Erreur de lecture NFC.';
        this.scanning = false;
      });
    },

    async handleTagRead(uid, router) {
      const auth = useAuthStore();
      if (!auth.isAuthenticated) {
        // L'app vient peut-être d'être lancée par ce tap : on garde le badge en
        // attente et on le traitera juste après la connexion.
        this.pendingTagUid = uid;
        if (router.currentRoute.value.name !== 'login') {
          router.push({ name: 'login' });
        }
        return;
      }

      this.scanning = true;
      try {
        await this.clockWithTag(uid);
      } finally {
        this.scanning = false;
      }
      if (router.currentRoute.value.name !== 'pointage') {
        router.push({ name: 'pointage' });
      }
    },

    async consumePendingTag(router) {
      if (!this.pendingTagUid) return;
      const uid = this.pendingTagUid;
      this.pendingTagUid = null;
      await this.handleTagRead(uid, router);
    },
  },
});
