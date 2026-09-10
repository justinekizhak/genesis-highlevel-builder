import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { firebaseEnabled, requireFirestore } from '@/services/firebase'
import { useAuthStore } from './auth'

export type Project = {
  id: string
  name: string
  description: string
  ownerId: string
  locationId: string | null
  deletedAt: string | null
  updatedAt: string
}

const demoSeed: Project = {
  id: 'local-demo',
  name: 'Contact intelligence',
  description: 'Search recent contacts and see upcoming appointments.',
  ownerId: 'demo-user',
  locationId: null,
  deletedAt: null,
  updatedAt: new Date().toISOString(),
}

const storageKey = 'genesis.demo.projects'

function readDemoProjects() {
  const saved = localStorage.getItem(storageKey)
  return saved ? JSON.parse(saved) as Project[] : [demoSeed]
}

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const loading = ref(false)
  const error = ref('')

  async function load() {
    const auth = useAuthStore()
    if (!auth.user) return
    loading.value = true
    error.value = ''
    try {
      if (!firebaseEnabled) {
        projects.value = readDemoProjects().filter((project) => !project.deletedAt)
        return
      }
      const snapshot = await getDocs(query(collection(requireFirestore(), 'projects'), where('ownerId', '==', auth.user.uid)))
      projects.value = snapshot.docs
        .map((document) => {
          const data = document.data()
          return {
            ...data,
            id: document.id,
            updatedAt: data.updatedAt?.toDate?.().toISOString() ?? new Date().toISOString(),
          } as Project
        })
        .filter((project) => !project.deletedAt)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not load projects.'
    } finally {
      loading.value = false
    }
  }

  async function create(name: string, description: string) {
    const auth = useAuthStore()
    if (!auth.user) throw new Error('Sign in before creating a project.')
    const project: Omit<Project, 'id'> = {
      name,
      description,
      ownerId: auth.user.uid,
      locationId: null,
      deletedAt: null,
      updatedAt: new Date().toISOString(),
    }

    if (!firebaseEnabled) {
      const created = { ...project, id: crypto.randomUUID() }
      const all = [created, ...readDemoProjects()]
      localStorage.setItem(storageKey, JSON.stringify(all))
      projects.value = all.filter((item) => !item.deletedAt)
      return created
    }

    const document = await addDoc(collection(requireFirestore(), 'projects'), {
      ...project,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    const created = { ...project, id: document.id }
    projects.value.unshift(created)
    return created
  }

  async function softDelete(projectId: string) {
    if (!firebaseEnabled) {
      const all = readDemoProjects().map((project) => project.id === projectId ? { ...project, deletedAt: new Date().toISOString() } : project)
      localStorage.setItem(storageKey, JSON.stringify(all))
      projects.value = all.filter((project) => !project.deletedAt)
      return
    }
    await updateDoc(doc(requireFirestore(), 'projects', projectId), { deletedAt: serverTimestamp() })
    projects.value = projects.value.filter((project) => project.id !== projectId)
  }

  return { projects, loading, error, load, create, softDelete }
})
