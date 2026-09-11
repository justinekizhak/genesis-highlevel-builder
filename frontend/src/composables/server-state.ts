import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useAuthStore } from '@/stores/auth'
import { useHighLevelStore } from '@/stores/highlevel'
import { useProjectsStore } from '@/stores/projects'

export function useProjectsQuery() {
  const auth = useAuthStore()
  const projects = useProjectsStore()
  return useQuery({
    queryKey: computed(() => ['projects', auth.user?.uid ?? 'signed-out']),
    enabled: computed(() => Boolean(auth.user)),
    queryFn: async () => {
      await projects.load()
      return projects.projects
    },
  })
}

export function useIntegrationStatusQuery() {
  const auth = useAuthStore()
  const highLevel = useHighLevelStore()
  return useQuery({
    queryKey: computed(() => ['integration-status', auth.user?.uid ?? 'signed-out']),
    enabled: computed(() => Boolean(auth.user) && highLevel.canConnect),
    queryFn: async () => {
      await highLevel.loadStatus()
      if (highLevel.error) throw new Error(highLevel.error)
      return { connection: highLevel.connection, llm: highLevel.llm }
    },
  })
}
