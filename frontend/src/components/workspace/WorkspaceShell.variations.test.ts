import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'

const generateApplication = vi.fn()
const loadApplicationState = vi.fn()
const loadVariationSet = vi.fn()
const selectVariationFinalist = vi.fn()
const listApplicationSnapshots = vi.fn()
const invalidateQueries = vi.fn()
const buildSrcdoc = vi.fn(() => '<html>standalone preview</html>')

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { projectId: 'project-1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => ({
    fetchQuery: (options: { queryFn: () => unknown }) => options.queryFn(),
    invalidateQueries,
  }),
  useQuery: () => ({ data: ref(undefined) }),
}))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => undefined),
  orderBy: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  Timestamp: { now: () => ({ toMillis: () => 0 }) },
}))
vi.mock('@/services/firebase', () => ({
  requireFirestore: () => ({}),
  firebaseEnabled: false,
}))
vi.mock('@/lib/monaco', () => ({ monaco: {} }))
vi.mock('@/components/workspace/CodeEditor.vue', () => ({ default: { name: 'CodeEditor', template: '<div />' } }))
vi.mock('@/lib/models', () => ({
  appendToModel: vi.fn(),
  disposeAllModels: vi.fn(),
  getOrCreateModel: vi.fn(),
  setModelValue: vi.fn(),
}))
vi.mock('@/lib/motion', () => ({
  animateEntrance: vi.fn().mockResolvedValue({ cancel: vi.fn() }),
  animateFeedback: vi.fn(),
}))
vi.mock('@/lib/srcdoc', () => ({ buildSrcdoc }))
vi.mock('@/composables/server-state', () => ({ useIntegrationStatusQuery: vi.fn() }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { uid: 'user-1' }, getIdToken: async () => 'token', signOut: vi.fn() }),
}))
vi.mock('@/stores/highlevel', () => ({
  useHighLevelStore: () => ({
    connection: { connected: true, locationName: 'Test location' },
    llm: { model: 'gpt-5.4-mini' },
    loading: false,
    canConnect: true,
    functionsBase: 'https://functions.example.test/v1',
    connect: vi.fn(),
    execute: vi.fn(),
  }),
}))
vi.mock('@/stores/projects', () => ({
  useProjectsStore: () => ({ projects: [{ id: 'project-1', name: 'CRM' }], load: vi.fn(), update: vi.fn() }),
}))
vi.mock('@/services/generation', () => ({
  generateApplication,
  loadApplicationState,
  loadVariationSet,
  selectVariationFinalist,
  listApplicationSnapshots,
  cancelApplicationGeneration: vi.fn(),
  loadSnapshotFiles: vi.fn(),
  restoreApplicationSnapshot: vi.fn(),
  saveApplicationFiles: vi.fn().mockResolvedValue({ files: {}, snapshotId: 's1' }),
  updateSnapshotField: vi.fn(),
}))

const stubs = {
  CodeEditor: true,
  CommandPalette: true,
  ShortcutsDialog: true,
  SuggestionChips: true,
  SnapshotHistory: true,
  VariationProgress: true,
  VariationComparison: true,
}

const finalistMetadata = {
  type: 'finalist_metadata' as const,
  variationSetId: 'set-1',
  finalists: [
    { candidateId: 'a', displayName: 'Direction A' as const, summary: 'A', standout: '' },
    { candidateId: 'b', displayName: 'Direction B' as const, summary: 'B', standout: '' },
  ],
}

async function mountShell() {
  const WorkspaceShell = (await import('./WorkspaceShell.vue')).default
  const wrapper = mount(WorkspaceShell, { global: { stubs } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  // jsdom has no matchMedia; the workspace's motion guards consult it.
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
  loadApplicationState.mockResolvedValue({ snapshotId: 'base-snapshot', files: null, messages: [] })
  listApplicationSnapshots.mockResolvedValue([])
})

describe('WorkspaceShell variation routing', () => {
  it('keeps single file deltas on the existing editor path', async () => {
    const wrapper = await mountShell()
    const vm = wrapper.vm as any

    vm.handleEvent({ type: 'file_start', path: 'index.html', language: 'html' })
    vm.handleEvent({ type: 'file_delta', path: 'index.html', delta: '<div id="app">' })

    expect(vm.files['index.html']?.content).toBe('<div id="app">')
    expect(vm.variationState.mode).toBe('idle')
  })

  it('does not mutate editor files while finalists are arriving', async () => {
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    const before = JSON.parse(JSON.stringify(vm.files))

    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    vm.handleEvent(finalistMetadata)
    vm.handleEvent({ type: 'finalist_file_start', candidateId: 'a', path: 'index.html', language: 'html' })
    vm.handleEvent({ type: 'finalist_file_delta', candidateId: 'a', path: 'index.html', delta: '<main>A</main>' })

    expect(JSON.parse(JSON.stringify(vm.files))).toEqual(before)
    expect(vm.variationState.mode).toBe('variations-running')
  })

  it('replaces the code and preview panels only while a variation is active', async () => {
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    expect(wrapper.find('.variation-stage').exists()).toBe(false)

    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    await flushPromises()

    expect(wrapper.find('.variation-stage').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'VariationProgress' }).exists()).toBe(true)
  })

  it('streams variation milestones into one live Genesis chat message', async () => {
    const wrapper = await mountShell()
    const vm = wrapper.vm as any

    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    vm.handleEvent({ type: 'candidate_started', candidateId: 'opaque-a', index: 0 })
    vm.handleEvent({ type: 'candidate_progress', candidateId: 'opaque-a', phase: 'markup' })
    await flushPromises()

    const activity = wrapper.find('[data-variation-activity]')
    expect(activity.exists()).toBe(true)
    expect(activity.text()).toContain('Four response briefs are ready')
    expect(activity.text()).toContain('Response 1 is writing the interface')
    expect(activity.text()).not.toContain('opaque-a')
  })

  it('keeps live variation activity in view when the reader is near the bottom', async () => {
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    const container = wrapper.find('.messages').element as HTMLElement
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 390, writable: true },
    })

    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    await flushPromises()

    expect(container.scrollTop).toBe(500)
  })

  it('preserves the collapsed chat layout while responses are active', async () => {
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    await flushPromises()

    await wrapper.get('[aria-label="Collapse conversation"]').trigger('click')

    expect(wrapper.get('.workspace').classes()).toContain('is-chat-collapsed')
  })

  it('shows the comparison once both finalists are ready', async () => {
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    vm.handleEvent(finalistMetadata)
    vm.handleEvent({ type: 'variation_complete', variationSetId: 'set-1' })
    await flushPromises()

    expect(vm.variationState.mode).toBe('variations-ready')
    expect(wrapper.findComponent({ name: 'VariationComparison' }).exists()).toBe(true)
  })

  it('opens a finalist with the authenticated standalone API bridge', async () => {
    const opened = { opener: window, location: { href: '' } }
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window)
    const createObjectURL = vi.fn(() => 'blob:response-preview')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    vm.handleEvent(finalistMetadata)
    vm.handleEvent({ type: 'variation_complete', variationSetId: 'set-1' })
    await flushPromises()
    buildSrcdoc.mockClear()

    wrapper.findComponent({ name: 'VariationComparison' }).vm.$emit('open-preview', vm.variationState.finalists[0])
    await flushPromises()

    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(buildSrcdoc).toHaveBeenCalledWith(vm.variationState.finalists[0].files, {
      enableHighLevelBridge: true,
      highLevelDirectProxy: { functionsBase: 'https://functions.example.test/v1', idToken: 'token' },
    })
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(opened.location.href).toBe('blob:response-preview')
  })

  it('surfaces a blocked finalist preview popup in the comparison', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    vm.handleEvent(finalistMetadata)
    vm.handleEvent({ type: 'variation_complete', variationSetId: 'set-1' })
    await flushPromises()

    const comparison = wrapper.findComponent({ name: 'VariationComparison' })
    comparison.vm.$emit('open-preview', vm.variationState.finalists[0])
    await flushPromises()

    expect(comparison.props('error')).toContain('preview tab was blocked')
  })

  it('hydrates the chosen files only after selection succeeds', async () => {
    const selectedFiles = { 'index.html': '<main>A</main>', 'styles.css': 'body{}', 'app.js': '// a' }
    selectVariationFinalist.mockResolvedValue({ snapshotId: 'snapshot-a', files: selectedFiles })
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    vm.handleEvent(finalistMetadata)
    vm.handleEvent({ type: 'variation_complete', variationSetId: 'set-1' })
    await flushPromises()

    await vm.chooseFinalist('a')
    await flushPromises()

    expect(vm.files['index.html']?.content).toBe(selectedFiles['index.html'])
    expect(vm.currentSnapshotId).toBe('snapshot-a')
    expect(vm.variationState.mode).toBe('idle')
  })

  it('offers a chat action to compare the same responses again after selection', async () => {
    selectVariationFinalist.mockResolvedValue({ snapshotId: 'snapshot-a', files: { 'app.js': '// selected' } })
    loadVariationSet.mockResolvedValue({
      variationSetId: 'set-1',
      status: 'selected',
      finalists: [
        { candidateId: 'a', displayName: 'Direction A', summary: 'A', standout: '', files: { 'app.js': '// a' } },
        { candidateId: 'b', displayName: 'Direction B', summary: 'B', standout: '', files: { 'app.js': '// b' } },
      ],
    })
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    vm.handleEvent(finalistMetadata)
    vm.handleEvent({ type: 'variation_complete', variationSetId: 'set-1' })
    await vm.chooseFinalist('a')
    await flushPromises()

    const reopen = wrapper.get('[data-reopen-comparison]')
    expect(reopen.text()).toContain('Compare responses again')
    await reopen.trigger('click')
    await flushPromises()

    expect(loadVariationSet).toHaveBeenCalledWith('project-1', 'set-1', expect.any(String))
    expect(vm.variationState.mode).toBe('variations-ready')
  })

  it('keeps the comparison open and retryable when selection fails', async () => {
    selectVariationFinalist.mockRejectedValue(new Error('This project changed in another tab'))
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    vm.handleEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    vm.handleEvent(finalistMetadata)
    vm.handleEvent({ type: 'variation_complete', variationSetId: 'set-1' })
    await flushPromises()

    await vm.chooseFinalist('a')
    await flushPromises()

    expect(vm.variationState.mode).toBe('variations-ready')
    expect(vm.variationError).toContain('changed in another tab')
    expect(Object.keys(vm.files)).toHaveLength(0)
  })

  it('restores a pending comparison during project hydration', async () => {
    loadApplicationState.mockResolvedValue({
      snapshotId: 'base-snapshot',
      pendingVariationSetId: 'set-1',
      files: { 'app.js': 'existing' },
      messages: [],
    })
    loadVariationSet.mockResolvedValue({
      variationSetId: 'set-1',
      status: 'ready',
      finalists: [
        { candidateId: 'a', displayName: 'Direction A', summary: 'A', standout: '', files: { 'app.js': '// a' } },
        { candidateId: 'b', displayName: 'Direction B', summary: 'B', standout: '', files: { 'app.js': '// b' } },
      ],
    })
    const wrapper = await mountShell()
    await flushPromises()
    const vm = wrapper.vm as any

    expect(loadVariationSet).toHaveBeenCalledWith('project-1', 'set-1', expect.any(String))
    expect(vm.variationState.mode).toBe('variations-ready')
    expect(vm.files['app.js']?.content).toBe('existing')
  })

  it('leaves existing files usable when a pending comparison cannot be reloaded', async () => {
    loadApplicationState.mockResolvedValue({
      snapshotId: 'base-snapshot',
      pendingVariationSetId: 'set-1',
      files: { 'app.js': 'existing' },
      messages: [],
    })
    loadVariationSet.mockRejectedValue(new Error('That comparison was not found.'))
    const wrapper = await mountShell()
    await flushPromises()
    const vm = wrapper.vm as any

    expect(vm.variationState.mode).toBe('idle')
    expect(vm.files['app.js']?.content).toBe('existing')
    expect(vm.variationError).toContain('not found')
  })

  it('reopens both finalists from a variation snapshot', async () => {
    loadVariationSet.mockResolvedValue({
      variationSetId: 'set-1',
      status: 'selected',
      finalists: [
        { candidateId: 'a', displayName: 'Direction A', summary: 'A', standout: '', files: { 'app.js': '// a' } },
        { candidateId: 'b', displayName: 'Direction B', summary: 'B', standout: '', files: { 'app.js': '// b' } },
      ],
    })
    const wrapper = await mountShell()
    const vm = wrapper.vm as any

    await vm.openVariationComparison({ variationSetId: 'set-1' })
    await flushPromises()

    expect(loadVariationSet).toHaveBeenCalledWith('project-1', 'set-1', expect.any(String))
    expect(vm.variationState.mode).toBe('variations-ready')
  })

  it('routes variation events away from the single-generation switch', async () => {
    const wrapper = await mountShell()
    const vm = wrapper.vm as any
    vm.handleEvent({ type: 'variation_planning_started' })
    expect(vm.variationState.mode).toBe('idle')
    vm.handleEvent({ type: 'token', delta: 'Working on it' })
    expect(vm.variationState.mode).toBe('idle')
  })
})
