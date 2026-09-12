<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import {
  IconArrowUpRight,
  IconBraces,
  IconChevronRight,
  IconCpu,
  IconEdit,
  IconFolderPlus,
  IconLogout,
  IconPlus,
  IconPlugConnected,
  IconPlugConnectedX,
  IconTrash,
} from '@tabler/icons-vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuthStore } from '@/stores/auth'
import { useHighLevelStore } from '@/stores/highlevel'
import { useProjectsStore } from '@/stores/projects'
import type { Project } from '@/stores/projects'
import { useIntegrationStatusQuery, useProjectsQuery } from '@/composables/server-state'
import { animateEntrance } from '@/lib/motion'

const auth = useAuthStore()
const projectsStore = useProjectsStore()
const highLevel = useHighLevelStore()
const router = useRouter()
const route = useRoute()
const queryClient = useQueryClient()
const { isLoading: projectsLoading } = useProjectsQuery()
useIntegrationStatusQuery()
const page = ref<HTMLElement>()
const createOpen = ref(false)
const editingProject = ref<Project>()
const deleteTarget = ref<Project>()
const name = ref('')
const description = ref('')
const mutationError = ref('')
let entranceAnimation: { cancel?: () => void } | undefined

const saveProjectMutation = useMutation({
  mutationFn: async (input: { project?: Project; name: string; description: string }) => {
    if (input.project) {
      await projectsStore.update(input.project.id, { name: input.name, description: input.description })
      return input.project
    }
    return projectsStore.create(input.name, input.description, highLevel.connection.locationId ?? null)
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
})
const deleteProjectMutation = useMutation({
  mutationFn: (projectId: string) => projectsStore.softDelete(projectId),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
})
const creating = computed(() => saveProjectMutation.isPending.value)

onMounted(async () => {
  await nextTick()
  entranceAnimation = await animateEntrance(page.value?.querySelectorAll('[data-enter]') ?? [])
})
onBeforeUnmount(() => entranceAnimation?.cancel?.())

function openProjectEditor(project?: Project) {
  editingProject.value = project
  name.value = project?.name ?? ''
  description.value = project?.description ?? ''
  mutationError.value = ''
  createOpen.value = true
}

async function saveProject() {
  if (!name.value.trim()) return
  mutationError.value = ''
  try {
    const project = await saveProjectMutation.mutateAsync({
      project: editingProject.value,
      name: name.value.trim(),
      description: description.value.trim(),
    })
    if (editingProject.value) {
      createOpen.value = false
      return
    }
    createOpen.value = false
    await router.push(`/projects/${project.id}`)
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause.message : 'Could not save the project.'
  }
}

async function deleteProject() {
  if (!deleteTarget.value) return
  mutationError.value = ''
  try {
    await deleteProjectMutation.mutateAsync(deleteTarget.value.id)
    deleteTarget.value = undefined
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause.message : 'Could not delete the project.'
  }
}

async function signOut() {
  await auth.signOut()
  await router.replace('/sign-in')
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
          <h1>What are we building?</h1>
          <span>Create a workspace, describe the outcome, and review every generated file.</span>
        </div>
        <Button @click="openProjectEditor()"><IconPlus :size="16" />New project</Button>
      </section>

      <p v-if="route.query.oauth === 'connected'" class="oauth-result success">HighLevel connected successfully.</p>
      <p v-if="route.query.oauth === 'failed'" class="oauth-result error">HighLevel connection failed. Check the function logs and try again.</p>

      <div class="integration-list" data-enter>
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
        <section class="connection-row model-info" aria-label="Generation model">
          <div class="connection-copy model-info-copy">
            <IconCpu :size="20" />
            <div>
              <span class="model-info-label">Generation model</span>
              <strong>{{ highLevel.llm.configured ? highLevel.llm.model : 'AI model is not configured' }}</strong>
              <span>{{ highLevel.llm.configured ? 'Used for structured app generation.' : 'Set the Firebase OPENAI_API_KEY secret to enable generation.' }}</span>
            </div>
          </div>
        </section>
      </div>
      <p v-if="highLevel.error" class="form-error connection-error">{{ highLevel.error }}</p>

      <section class="project-section" data-enter>
        <div class="project-section-heading"><h2>Your workspaces</h2><Badge variant="secondary">{{ projectsStore.projects.length }} projects</Badge></div>
        <p v-if="projectsStore.error" class="form-error">{{ projectsStore.error }}</p>
        <p v-if="mutationError && !createOpen" class="form-error project-error" role="alert">{{ mutationError }}</p>
        <div v-if="projectsLoading" class="project-loading"><span /><span /><span /></div>
        <TransitionGroup v-else-if="projectsStore.projects.length" name="project-list" tag="div" class="project-list">
          <article v-for="project in projectsStore.projects" :key="project.id" class="project-row">
            <button class="project-open" @click="router.push(`/projects/${project.id}`)">
              <div class="project-glyph"><IconArrowUpRight :size="18" /></div>
              <div><strong>{{ project.name }}</strong><span>{{ project.description || 'No description yet.' }}</span></div>
              <time>{{ new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }}</time>
              <IconChevronRight :size="17" />
            </button>
            <div class="project-actions">
              <Button variant="ghost" size="icon" :aria-label="`Edit ${project.name}`" @click="openProjectEditor(project)"><IconEdit :size="16" /></Button>
              <Button variant="ghost" size="icon" :aria-label="`Delete ${project.name}`" @click="deleteTarget = project"><IconTrash :size="16" /></Button>
            </div>
          </article>
        </TransitionGroup>
        <div v-else class="project-empty">
          <IconFolderPlus :size="26" />
          <h3>No projects yet</h3>
          <p>Create the first workspace and generate a HighLevel interface.</p>
        </div>
      </section>
    </div>

    <Dialog v-model:open="createOpen">
      <DialogContent class="project-dialog" aria-describedby="project-editor-description">
      <form @submit.prevent="saveProject">
        <div class="dialog-heading"><div><DialogTitle>{{ editingProject ? 'Edit project' : 'New project' }}</DialogTitle><DialogDescription id="project-editor-description">Name the outcome, not the implementation.</DialogDescription></div></div>
        <label for="project-name">Project name</label>
        <Input id="project-name" v-model="name" required placeholder="Contact intelligence" />
        <label for="project-description">Description</label>
        <Textarea id="project-description" v-model="description" aria-label="Project description" placeholder="Search contacts and show upcoming appointments." />
        <p v-if="mutationError" class="form-error" role="alert">{{ mutationError }}</p>
        <div class="dialog-actions"><DialogClose as-child><Button type="button" variant="ghost">Cancel</Button></DialogClose><Button type="submit" :disabled="creating || !name.trim()">{{ creating ? 'Saving' : editingProject ? 'Save changes' : 'Create project' }}</Button></div>
      </form>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="Boolean(deleteTarget)" @update:open="(open) => { if (!open) deleteTarget = undefined }">
      <AlertDialogContent class="alert-dialog" aria-describedby="delete-project-description">
        <AlertDialogTitle>Delete {{ deleteTarget?.name }}?</AlertDialogTitle>
        <AlertDialogDescription id="delete-project-description">This soft-deletes the project and removes it from your dashboard. Its stored data is retained.</AlertDialogDescription>
        <div class="dialog-actions">
          <AlertDialogCancel as-child><Button variant="ghost">Cancel</Button></AlertDialogCancel>
          <Button @click="deleteProject">Delete project</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  </main>
</template>
