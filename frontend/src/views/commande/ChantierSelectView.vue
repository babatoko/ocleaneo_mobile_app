<script setup>
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useChantiersStore } from '../../stores/chantiers';
import AppHeader from '../../components/AppHeader.vue';

const chantiers = useChantiersStore();
const router = useRouter();

onMounted(() => chantiers.fetchMine());

function choose(chantier) {
  chantiers.select(chantier.id);
  router.push('/commande/catalogue');
}
</script>

<template>
  <AppHeader title="Choisir un chantier" />
  <div class="list">
    <button v-for="c in chantiers.list" :key="c.id" class="chantier" @click="choose(c)">
      <strong>{{ c.name }}</strong>
      <span v-if="c.address">{{ c.address }}</span>
    </button>
    <p v-if="!chantiers.list.length" class="empty">Aucun chantier affecté pour le moment.</p>
  </div>
</template>

<style scoped>
.list {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chantier {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  text-align: left;
}

.chantier span {
  color: var(--text-muted);
  font-size: 13px;
}

.empty {
  text-align: center;
  color: var(--text-muted);
  margin-top: 32px;
}
</style>
