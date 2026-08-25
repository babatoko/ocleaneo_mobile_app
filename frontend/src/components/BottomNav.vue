<script setup lang="ts">
import { IonIcon, IonTabBar } from '@ionic/vue';
import { calendarOutline, timeOutline, cartOutline, receiptOutline, personOutline } from 'ionicons/icons';
</script>

<template>
  <ion-tab-bar class="bottom-nav" aria-label="Navigation principale">
    <RouterLink to="/planning" class="nav-item">
      <ion-icon :icon="calendarOutline" aria-hidden="true"></ion-icon>
      <span class="lbl">Planning</span>
    </RouterLink>
    <RouterLink to="/pointage" class="nav-item">
      <ion-icon :icon="timeOutline" aria-hidden="true"></ion-icon>
      <span class="lbl">Pointage</span>
    </RouterLink>
    <RouterLink to="/commande/catalogue" class="nav-item">
      <ion-icon :icon="cartOutline" aria-hidden="true"></ion-icon>
      <span class="lbl">Commande</span>
    </RouterLink>
    <RouterLink to="/historique" class="nav-item">
      <ion-icon :icon="receiptOutline" aria-hidden="true"></ion-icon>
      <span class="lbl">Historique</span>
    </RouterLink>
    <RouterLink to="/profil" class="nav-item">
      <ion-icon :icon="personOutline" aria-hidden="true"></ion-icon>
      <span class="lbl">Profil</span>
    </RouterLink>
  </ion-tab-bar>
</template>
