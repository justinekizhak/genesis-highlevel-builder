<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IconArrowRight, IconBraces, IconShieldLock } from '@tabler/icons-vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ mode: 'sign-in' | 'sign-up' }>()
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const name = ref('')
const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

const isSignUp = computed(() => props.mode === 'sign-up')

async function submit() {
  error.value = ''
  busy.value = true
  try {
    if (isSignUp.value) await auth.signUp(name.value.trim(), email.value.trim(), password.value)
    else await auth.signIn(email.value.trim(), password.value)
    await router.replace(typeof route.query.redirect === 'string' ? route.query.redirect : '/projects')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Authentication failed.'
  } finally {
    busy.value = false
  }
}

async function continueDemo() {
  email.value = 'builder@genesis.local'
  password.value = 'demo-password'
  await submit()
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-context">
      <div class="auth-brand"><span><IconBraces :size="20" /></span><strong>Genesis</strong></div>
      <div class="auth-copy">
        <p>HighLevel app builder</p>
        <h1>Turn CRM ideas into working interfaces.</h1>
        <span>Generate focused applications that read real contacts, conversations, and calendars through a secure gateway.</span>
      </div>
      <div class="auth-security"><IconShieldLock :size="18" /><span>HighLevel tokens stay server-side. Generated code receives no credentials.</span></div>
    </section>

    <section class="auth-form-panel">
      <form class="auth-form" @submit.prevent="submit">
        <div>
          <h2>{{ isSignUp ? 'Create your account' : 'Welcome back' }}</h2>
          <p>{{ isSignUp ? 'Start a new HighLevel builder workspace.' : 'Continue building your HighLevel projects.' }}</p>
        </div>

        <div v-if="auth.isDemoMode" class="demo-notice">
          Firebase is not configured, so this session will use local demo storage.
        </div>

        <label v-if="isSignUp" for="name">Name</label>
        <Input v-if="isSignUp" id="name" v-model="name" autocomplete="name" required placeholder="Your name" />

        <label for="email">Email</label>
        <Input id="email" v-model="email" type="email" autocomplete="email" required placeholder="you@company.com" />

        <label for="password">Password</label>
        <Input id="password" v-model="password" type="password" :autocomplete="isSignUp ? 'new-password' : 'current-password'" required :minlength="6" placeholder="At least 6 characters" />

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>

        <Button type="submit" class="auth-submit" :disabled="busy">
          {{ busy ? 'Please wait' : isSignUp ? 'Create account' : 'Sign in' }}
          <IconArrowRight v-if="!busy" :size="16" />
        </Button>

        <Button v-if="auth.isDemoMode" type="button" variant="secondary" class="auth-submit" @click="continueDemo">Continue with demo</Button>

        <p class="auth-switch">
          {{ isSignUp ? 'Already have an account?' : 'New to Genesis?' }}
          <RouterLink :to="isSignUp ? '/sign-in' : '/sign-up'">{{ isSignUp ? 'Sign in' : 'Create account' }}</RouterLink>
        </p>
      </form>
    </section>
  </main>
</template>
