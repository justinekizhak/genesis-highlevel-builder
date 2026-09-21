import { computed, ref } from 'vue'
import { loadVariationSet, selectVariationFinalist } from '@/services/generation'
import {
  finalistFilesFor,
  idleVariationState,
  reduceVariationEvent,
  variationStateFromPayload,
  VariationReconstructionError,
} from './variation-state'
import type { GenerationEvent, VariationPhase, WorkspaceGenerationState } from '@/types/generation'

/** Truthful copy: every line corresponds to a phase the server actually reported. */
export const variationPhaseCopy: Record<VariationPhase, string> = {
  planning: 'Preparing response briefs',
  generating: 'Generating code for four responses',
  validating: 'Checking each response against your request',
  grading: 'Comparing the strongest responses',
  preparing: 'Loading the two final previews',
}

export function useVariationGeneration(projectId: () => string, getIdToken: () => Promise<string | undefined>) {
  const state = ref<WorkspaceGenerationState>(idleVariationState())
  const error = ref('')
  const isReloading = ref(false)

  const isActive = computed(() => state.value.mode !== 'idle' && state.value.mode !== 'single')
  const phaseLabel = computed(() => (
    state.value.mode === 'variations-running' ? variationPhaseCopy[state.value.phase] : ''
  ))
  const finalists = computed(() => (
    state.value.mode === 'variations-ready' || state.value.mode === 'variation-selecting' ? state.value.finalists : []
  ))
  const selectingCandidateId = computed(() => (
    state.value.mode === 'variation-selecting' ? state.value.candidateId : undefined
  ))

  function reset() {
    state.value = idleVariationState()
    error.value = ''
  }

  function accept(event: GenerationEvent) {
    try {
      state.value = reduceVariationEvent(state.value, event)
    } catch (cause) {
      // A reconstruction failure is recoverable: the persisted set can still be reloaded, and no
      // active workspace file has been touched.
      error.value = cause instanceof VariationReconstructionError
        ? cause.message
        : 'The comparison could not be assembled. Reload the project to try again.'
    }
  }

  async function reloadPendingVariation(variationSetId: string) {
    if (isReloading.value) return
    isReloading.value = true
    error.value = ''
    try {
      state.value = variationStateFromPayload(await loadVariationSet(projectId(), variationSetId, await getIdToken()))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not restore the comparison.'
      throw cause
    } finally {
      isReloading.value = false
    }
  }

  /** Resolves with the chosen files only after the server promoted them; never writes files itself. */
  async function selectFinalist(candidateId: string) {
    const current = state.value
    if (current.mode !== 'variations-ready') return
    const variationSetId = current.variationSetId
    error.value = ''
    state.value = { mode: 'variation-selecting', variationSetId, candidateId, finalists: current.finalists }
    try {
      return await selectVariationFinalist(projectId(), variationSetId, candidateId, await getIdToken())
    } catch (cause) {
      // Both previews stay mounted so the user can retry or pick the other response.
      state.value = current
      error.value = cause instanceof Error ? cause.message : 'Could not apply that response.'
      throw cause
    }
  }

  return {
    state,
    error,
    isActive,
    isReloading,
    phaseLabel,
    finalists,
    selectingCandidateId,
    accept,
    reset,
    reloadPendingVariation,
    selectFinalist,
    finalistFilesFor,
  }
}
