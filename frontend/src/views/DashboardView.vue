<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  IconArrowUpRight,
  IconBraces,
  IconChevronRight,
  IconCpu,
  IconLogout,
  IconPlus,
  IconPlugConnected,
  IconPlugConnectedX,
  IconX,
} from '@tabler/icons-vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { useAuthStore } from '@/stores/auth'
import { useHighLevelStore } from '@/stores/highlevel'
import { useProjectsStore } from '@/stores/projects'

const auth = useAuthStore()
const projectsStore = useProjectsStore()
const highLevel = useHighLevelStore()
const router = useRouter()
const route = useRoute()
const createOpen = ref(false)
const name = ref('')
const description = ref('')
const creating = ref(false)

onMounted(() => {
  projectsStore.load()
  highLevel.loadStatus()
})

async function createProject() {
  if (!name.value.trim()) return
  creating.value = true
  try {
    const project = await projectsStore.create(name.value.trim(), description.value.trim())
    createOpen.value = false
    await router.push(`/projects/${project.id}`)
  } finally {
    creating.value = false
  }
}

async function signOut() {
  await auth.signOut()
  await router.replace('/sign-in')
}
</script>

<template>
  <main class="dashboard-page">
    <header class="dashboard-nav">
      <div class="auth-brand"><span><IconBraces :size="18" /></span><strong>Genesis</strong></div>
      <div class="dashboard-account">
        <span>{{ auth.user?.email }}</span>
        <Button variant="ghost" size="icon" aria-label="Sign out" @click="signOut"><IconLogout :size="17" /></Button>
      </div>
    </header>

    <div class="dashboard-content">
      <section class="dashboard-intro">
        <div>
          <p>Projects</p>
          <h1>What are we building?</h1>
          <span>Create a workspace, describe the outcome, and review every generated file.</span>
        </div>
        <Button @click="createOpen = true"><IconPlus :size="16" />New project</Button>
      </section>

      <p v-if="route.query.oauth === 'connected'" class="oauth-result success">HighLevel connected successfully.</p>
      <p v-if="route.query.oauth === 'failed'" class="oauth-result error">HighLevel connection failed. Check the function logs and try again.</p>

      <div class="integration-list">
        <section class="connection-row">
          <div class="connection-copy">
            <IconPlugConnected v-if="highLevel.connection.connected" :size="20" />
            <IconPlugConnectedX v-else :size="20" />
            <div>
              <strong>{{ highLevel.connection.connected ? highLevel.connection.locationName : 'HighLevel is not connected' }}</strong>
              <span>{{ highLevel.connection.connected ? 'Contacts, conversations, and calendars are available to generated apps.' : 'Connect one location to enable real CRM data.' }}</span>
            </div>
          </div>
          <Button
            variant="secondary"
            :disabled="!highLevel.canConnect || highLevel.loading || highLevel.connection.connected"
            @click="highLevel.connect"
          >
            {{ highLevel.loading ? 'Checking' : highLevel.connection.connected ? 'Connected' : 'Connect HighLevel' }}
          </Button>
        </section>
        <section class="connection-row">
          <div class="connection-copy">
            <IconCpu :size="20" />
            <div>
              <strong>{{ highLevel.llm.configured ? highLevel.llm.model : 'AI model is not configured' }}</strong>
              <span>{{ highLevel.llm.configured ? 'OpenAI structured generation is ready.' : 'Set the Firebase OPENAI_API_KEY secret to enable live generation.' }}</span>
            </div>
          </div>
          <Badge>{{ highLevel.llm.configured ? 'Ready' : 'Mock mode' }}</Badge>
        </section>
      </div>
      <p v-if="highLevel.error" class="form-error connection-error">{{ highLevel.error }}</p>

      <section class="project-section">
        <div class="project-section-heading"><h2>Your workspaces</h2><Badge>{{ projectsStore.projects.length }} projects</Badge></div>
        <p v-if="projectsStore.error" class="form-error">{{ projectsStore.error }}</p>
        <div v-if="projectsStore.loading" class="project-loading"><span /><span /><span /></div>
        <div v-else-if="projectsStore.projects.length" class="project-list">
          <button v-for="project in projectsStore.projects" :key="project.id" @click="router.push(`/projects/${project.id}`)">
            <div class="project-glyph"><IconArrowUpRight :size="18" /></div>
            <div><strong>{{ project.name }}</strong><span>{{ project.description || 'No description yet.' }}</span></div>
            <time>{{ new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}</time>
            <IconChevronRight :size="17" />
          </button>
        </div>
        <div v-else class="project-empty"><h3>No projects yet</h3><p>Create the first workspace and generate a HighLevel interface.</p></div>
      </section>
    </div>

    <div v-if="createOpen" class="dialog-backdrop" @click.self="createOpen = false">
      <form class="project-dialog" @submit.prevent="createProject">
        <div class="dialog-heading"><div><h2>New project</h2><p>Name the outcome, not the implementation.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Close dialog" @click="createOpen = false"><IconX :size="17" /></Button></div>
        <label for="project-name">Project name</label>
        <Input id="project-name" v-model="name" required placeholder="Contact intelligence" />
        <label for="project-description">Description</label>
        <Textarea id="project-description" v-model="description" aria-label="Project description" placeholder="Search contacts and show upcoming appointments." />
        <div class="dialog-actions"><Button type="button" variant="ghost" @click="createOpen = false">Cancel</Button><Button type="submit" :disabled="creating || !name.trim()">{{ creating ? 'Creating' : 'Create project' }}</Button></div>
      </form>
    </div>
  </main>
</template>
