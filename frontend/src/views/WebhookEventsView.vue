<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from 'firebase/firestore'
import { IconBraces, IconChevronDown, IconLogout, IconWebhook } from '@tabler/icons-vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth'
import { requireFirestore } from '@/services/firebase'
import { hlEventLabel } from '@/lib/highlevel-events'
import { animateEntrance } from '@/lib/motion'

type HlEventRow = {
  id: string
  type: string
  label: string
  locationId?: string
  entityId?: string
  createdAt: Date
  payload: unknown
}

const router = useRouter()
const auth = useAuthStore()
const page = ref<HTMLElement>()
const events = ref<HlEventRow[]>([])
const loading = ref(true)
const loadError = ref('')
const expandedId = ref<string>()
let entranceAnimation: { cancel?: () => void } | undefined
let stopListener: (() => void) | undefined

function entityIdFrom(payload: Record<string, unknown>): string | undefined {
  const candidate = payload.contactId ?? payload.appointmentId ?? payload.conversationId ?? payload.messageId
  return typeof candidate === 'string' ? candidate : undefined
}

function relativeTime(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000)
  const divisions: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Number.POSITIVE_INFINITY],
  ]
  let value = seconds
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, span] of divisions) {
    if (Math.abs(value) < span) return formatter.format(Math.round(value), unit)
    value /= span
  }
  return formatter.format(Math.round(value), 'year')
}

const emptyStateReason = computed(() => (
  loadError.value
    ? loadError.value
    : 'Deliveries from your connected HighLevel location will show up here as they arrive.'
))

onMounted(async () => {
  const uid = auth.user?.uid
  if (uid) {
    const eventsQuery = query(
      collection(requireFirestore(), 'users', uid, 'hlEvents'),
      orderBy('createdAt', 'desc'),
      limit(50),
    )
    stopListener = onSnapshot(eventsQuery, (snapshot) => {
      loading.value = false
      events.value = snapshot.docs.map((document) => {
        const data = document.data() as { type: string; payload: Record<string, unknown>; createdAt: Timestamp }
        return {
          id: document.id,
          type: data.type,
          label: hlEventLabel(data.type),
          locationId: typeof data.payload?.locationId === 'string' ? data.payload.locationId : undefined,
          entityId: entityIdFrom(data.payload ?? {}),
          createdAt: data.createdAt?.toDate?.() ?? new Date(),
          payload: data.payload,
        }
      })
    }, (error) => {
      loading.value = false
      loadError.value = error instanceof Error ? error.message : 'Could not load webhook events.'
    })
  } else {
    loading.value = false
  }
  await nextTick()
  entranceAnimation = await animateEntrance(page.value?.querySelectorAll('[data-enter]') ?? [])
})

onBeforeUnmount(() => {
  stopListener?.()
  entranceAnimation?.cancel?.()
})

async function signOut() {
  await auth.signOut()
  await router.replace('/sign-in')
}

function toggleExpanded(id: string) {
  expandedId.value = expandedId.value === id ? undefined : id
}
</script>

<template>
  <main ref="page" class="dashboard-page">
    <header class="dashboard-nav">
      <div class="auth-brand"><span><IconBraces :size="18" /></span><strong>Genesis</strong></div>
      <div class="dashboard-account">
        <span>{{ auth.user?.email }}</span>
        <Button variant="ghost" size="icon" aria-label="Sign out" @click="signOut"><IconLogout :size="17" /></Button>
      </div>
    </header>

    <div class="dashboard-content">
      <section class="dashboard-intro" data-enter>
        <div>
          <h1>Webhook activity</h1>
          <span>Live HighLevel deliveries for your connected location — contacts, messages, and appointments as they change.</span>
        </div>
        <Button variant="secondary" @click="router.push('/projects')">Back to projects</Button>
      </section>

      <section class="project-section" data-enter>
        <div class="project-section-heading">
          <h2>Recent deliveries</h2>
          <Badge variant="secondary">{{ events.length }} events</Badge>
        </div>

        <div v-if="loading" class="project-loading"><span /><span /><span /></div>

        <div v-else-if="events.length" class="event-list">
          <article v-for="event in events" :key="event.id" class="event-row" :class="{ 'is-expanded': expandedId === event.id }">
            <button type="button" class="event-summary" @click="toggleExpanded(event.id)">
              <div class="event-glyph"><IconWebhook :size="18" /></div>
              <div class="event-copy">
                <strong>{{ event.label }}</strong>
                <span v-if="event.entityId">{{ event.entityId }}</span>
              </div>
              <time :title="event.createdAt.toLocaleString()">{{ relativeTime(event.createdAt) }}</time>
              <IconChevronDown :size="16" class="event-chevron" />
            </button>
            <pre v-if="expandedId === event.id" class="event-payload">{{ JSON.stringify(event.payload, null, 2) }}</pre>
          </article>
        </div>

        <div v-else class="project-empty event-empty">
          <IconWebhook :size="26" />
          <h3>No webhook events yet</h3>
          <p>{{ emptyStateReason }}</p>
        </div>
      </section>
    </div>
  </main>
</template>
