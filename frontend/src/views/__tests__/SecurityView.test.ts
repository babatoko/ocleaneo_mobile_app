import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonTitle,
  IonToolbar,
  IonToggle,
} from '@ionic/vue';
import { IonicVue } from '@ionic/vue';
import { nextTick } from 'vue';
import SecurityView from '../../views/SecurityView.vue';

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock('../../services/biometric', () => ({
  isBiometricAvailable: vi.fn(() => Promise.resolve(false)),
  hasSavedCredentials: vi.fn(() => Promise.resolve(false)),
  clearSavedCredentials: vi.fn(() => Promise.resolve()),
}));

const { useAuthStore } = await import('../../stores/auth');

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
});

const plugins = [IonicVue];
const components = {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonTitle,
  IonToolbar,
  IonToggle,
};

async function mountSecurity() {
  const wrapper = mount(SecurityView, {
    global: { plugins, components },
  });
  await nextTick();
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
  return wrapper;
}

describe('SecurityView', () => {
  it('affiche le titre de l’écran', async () => {
    const wrapper = await mountSecurity();
    expect(wrapper.html()).toContain('Sécurité');
  });

  it('rend trois champs de saisie', async () => {
    const wrapper = await mountSecurity();
    expect(wrapper.findAllComponents(IonInput).length).toBe(3);
  });

  it('désactive le bouton de validation si les champs sont vides', async () => {
    const wrapper = await mountSecurity();
    const auth = useAuthStore();
    const spy = vi.spyOn(auth, 'changePassword');
    await wrapper.find('.save-btn').trigger('click');
    expect(spy).not.toHaveBeenCalled();
  });

  it('active le bouton quand les trois champs sont remplis', async () => {
    const wrapper = await mountSecurity();
    const inputs = wrapper.findAllComponents(IonInput);
    inputs[0].vm.$emit('update:modelValue', 'CurrentPass1!');
    inputs[1].vm.$emit('update:modelValue', 'NewPassw0rd!!');
    inputs[2].vm.$emit('update:modelValue', 'NewPassw0rd!!');
    await nextTick();
    const auth = useAuthStore();
    const spy = vi.spyOn(auth, 'changePassword').mockResolvedValueOnce(undefined);
    await wrapper.find('.save-btn').trigger('click');
    expect(spy).toHaveBeenCalled();
  });

  it('appelle changePassword puis redirige vers /login à la soumission valide', async () => {
    const auth = useAuthStore();
    auth.token = 'token-fake';
    auth.employee = { id: 1, name: 'Test' };
    const changePasswordSpy = vi.spyOn(auth, 'changePassword').mockResolvedValueOnce(undefined);

    const wrapper = await mountSecurity();
    const inputs = wrapper.findAllComponents(IonInput);
    inputs[0].vm.$emit('update:modelValue', 'CurrentPass1!');
    inputs[1].vm.$emit('update:modelValue', 'NewPassw0rd!!');
    inputs[2].vm.$emit('update:modelValue', 'NewPassw0rd!!');
    await nextTick();

    await wrapper.find('.save-btn').trigger('click');
    await nextTick();
    await nextTick();

    expect(changePasswordSpy).toHaveBeenCalledWith('CurrentPass1!', 'NewPassw0rd!!');
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });

  it('affiche une erreur si les mots de passe ne correspondent pas', async () => {
    const wrapper = await mountSecurity();
    const inputs = wrapper.findAllComponents(IonInput);
    inputs[0].vm.$emit('update:modelValue', 'CurrentPass1!');
    inputs[1].vm.$emit('update:modelValue', 'NewPassw0rd!!');
    inputs[2].vm.$emit('update:modelValue', 'DifferentPass!!');
    await nextTick();

    await wrapper.find('.save-btn').trigger('click');
    await nextTick();

    expect(wrapper.html()).toContain('ne correspondent pas');
  });

  it('affiche une erreur si le mot de passe est trop court', async () => {
    const wrapper = await mountSecurity();
    const inputs = wrapper.findAllComponents(IonInput);
    inputs[0].vm.$emit('update:modelValue', 'CurrentPass1!');
    inputs[1].vm.$emit('update:modelValue', 'Short1!');
    inputs[2].vm.$emit('update:modelValue', 'Short1!');
    await nextTick();

    await wrapper.find('.save-btn').trigger('click');
    await nextTick();

    expect(wrapper.html()).toContain('12 caractères');
  });

  it('déconnecte au clic sur le bouton de déconnexion', async () => {
    const auth = useAuthStore();
    auth.token = 'token-fake';
    auth.employee = { id: 1, name: 'Test' };

    const wrapper = await mountSecurity();
    await wrapper.find('.logout-btn').trigger('click');

    expect(auth.isAuthenticated).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });
});
