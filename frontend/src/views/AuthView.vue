<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IconArrowRight, IconBraces, IconShieldLock } from '@tabler/icons-vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getAuthErrorMessage } from '@/lib/auth-error'
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
    error.value = getAuthErrorMessage(cause, props.mode)
  } finally {
    busy.value = false
  }
}

</script>

<template>
  <main class="auth-page">
    <section class="auth-context">
      <div class="auth-brand"><span><IconBraces :size="20" /></span><strong>Genesis</strong></div>
      <div class="auth-copy">
        <h1>Describe an app. Get one wired to your real HighLevel data.</h1>
        <span>Genesis turns a plain-English prompt into a working web app — a contact list, an inbox, a booking view — connected to your actual contacts, conversations, and calendar in HighLevel. Never sample data, never a mockup.</span>
      </div>
      <div class="auth-security"><IconShieldLock :size="18" /><span>Your HighLevel connection stays on our server. The app Genesis generates never sees your login or API keys.</span></div>
    </section>

    <section class="auth-form-panel">
      <form class="auth-form" @submit.prevent="submit">
        <div>
          <h2>{{ isSignUp ? 'Create your account' : 'Welcome back' }}</h2>
          <p>{{ isSignUp ? 'Start a new HighLevel builder workspace.' : 'Continue building your HighLevel projects.' }}</p>
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

        <p class="auth-switch">
          {{ isSignUp ? 'Already have an account?' : 'New to Genesis?' }}
          <RouterLink :to="isSignUp ? '/sign-in' : '/sign-up'">{{ isSignUp ? 'Sign in' : 'Create account' }}</RouterLink>
        </p>
      </form>
    </section>
  </main>
</template>
