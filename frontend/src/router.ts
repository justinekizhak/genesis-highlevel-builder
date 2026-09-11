import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const AuthView = () => import('@/views/AuthView.vue')
const DashboardView = () => import('@/views/DashboardView.vue')
const WorkspaceView = () => import('@/views/WorkspaceView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/projects' },
    { path: '/sign-in', component: AuthView, props: { mode: 'sign-in' }, meta: { public: true } },
    { path: '/sign-up', component: AuthView, props: { mode: 'sign-up' }, meta: { public: true } },
    { path: '/projects', component: DashboardView },
    { path: '/projects/:projectId', component: WorkspaceView },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.initialize()
  if (!to.meta.public && !auth.isAuthenticated) return { path: '/sign-in', query: { redirect: to.fullPath } }
  if (to.meta.public && auth.isAuthenticated) return '/projects'
})

export default router
