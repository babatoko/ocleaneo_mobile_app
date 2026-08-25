<script setup lang="ts">
import { IonIcon, IonTabBar } from '@ionic/vue';
import { calendarOutline, timeOutline, cartOutline, receiptOutline, personOutline } from 'ionicons/icons';

const items = [
  { to: '/planning', icon: calendarOutline, label: 'Planning' },
  { to: '/pointage', icon: timeOutline, label: 'Pointage' },
  { to: '/commande/catalogue', icon: cartOutline, label: 'Commande' },
  { to: '/historique', icon: receiptOutline, label: 'Historique' },
  { to: '/profil', icon: personOutline, label: 'Profil' },
];
</script>

<template>
  <!--
    ion-tab-bar pose role="tablist" tout seul ; il n'y a en revanche pas de
    vrai ion-tabs ici (routes à plat + ion-router-outlet unique, pas de
    sous-arborescence par onglet) donc pas d'ion-tab-button — sa navigation
    interne (ionRouter.changeTab/resetTab) suppose ce contexte et n'existe pas
    sans lui. On reste sur RouterLink pour la navigation, avec le v-slot pour
    poser nous-mêmes role="tab"/aria-selected — la sémantique qui manquait —
    sans la réécriture de routing qu'un vrai ion-tabs demanderait.
  -->
  <ion-tab-bar class="bottom-nav" aria-label="Navigation principale">
    <RouterLink v-for="item in items" :key="item.to" :to="item.to" custom v-slot="{ isActive, href, navigate }">
      <a :href="href" class="nav-item" :class="{ 'router-link-active': isActive }" role="tab" :aria-selected="isActive" @click="navigate">
        <ion-icon :icon="item.icon" aria-hidden="true"></ion-icon>
        <span class="lbl">{{ item.label }}</span>
      </a>
    </RouterLink>
  </ion-tab-bar>
</template>
