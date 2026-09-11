import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { firebaseEnabled, requireFirebaseAuth } from '@/services/firebase'

type SessionUser = Pick<User, 'uid' | 'email' | 'displayName'>

const demoUser: SessionUser = {
  uid: 'demo-user',
  email: 'builder@genesis.local',
  displayName: 'Demo Builder',
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null)
  const initializing = ref(true)
  const error = ref('')
  let initializationPromise: Promise<void> | null = null

  const isAuthenticated = computed(() => Boolean(user.value))
  const isDemoMode = computed(() => !firebaseEnabled)

  function initialize() {
    if (!initializationPromise) {
      initializationPromise = (async () => {
        if (!firebaseEnabled) {
          initializing.value = false
          return
        }

        const firebaseAuth = requireFirebaseAuth()

        await new Promise<void>((resolve) => {
          onAuthStateChanged(firebaseAuth, (firebaseUser) => {
            user.value = firebaseUser
            initializing.value = false
            resolve()
          })
        })
      })()
    }

    return initializationPromise
  }

  async function signIn(email: string, password: string) {
    error.value = ''
    if (!firebaseEnabled) {
      user.value = { ...demoUser, email: email || demoUser.email }
      return
    }
    const credential = await signInWithEmailAndPassword(requireFirebaseAuth(), email, password)
    user.value = credential.user
  }

  async function signUp(name: string, email: string, password: string) {
    error.value = ''
    if (!firebaseEnabled) {
      user.value = { ...demoUser, displayName: name, email }
      return
    }
    const credential = await createUserWithEmailAndPassword(requireFirebaseAuth(), email, password)
    await updateProfile(credential.user, { displayName: name })
    user.value = credential.user
  }

  async function signOut() {
    if (firebaseEnabled) await firebaseSignOut(requireFirebaseAuth())
    user.value = null
  }

  async function getIdToken() {
    if (!firebaseEnabled) return undefined
    return requireFirebaseAuth().currentUser?.getIdToken()
  }

  return { user, initializing, error, isAuthenticated, isDemoMode, initialize, signIn, signUp, signOut, getIdToken }
})
