import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import VariationProgress from './VariationProgress.vue'
import type { CandidateProgress } from '@/types/generation'

const candidates: Record<string, CandidateProgress> = {
  a: { candidateId: 'a', index: 0, phase: 'logic' },
  b: { candidateId: 'b', index: 1, phase: 'styles' },
  c: { candidateId: 'c', index: 2, phase: 'complete' },
  d: { candidateId: 'd', index: 3, phase: 'failed' },
}

describe('VariationProgress', () => {
  it('renders only the phase supplied by real events', () => {
    const wrapper = mount(VariationProgress, { props: { phase: 'grading', candidates } })
    expect(wrapper.text()).toContain('Comparing the strongest responses')
    expect(wrapper.text()).not.toMatch(/\d+%/)
  })

  it('uses response language for every phase and never invents one', () => {
    for (const [phase, copy] of Object.entries({
      planning: 'Preparing response briefs',
      generating: 'Generating code for four responses',
      validating: 'Checking each response against your request',
      preparing: 'Loading the two final previews',
    })) {
      const wrapper = mount(VariationProgress, { props: { phase: phase as never, candidates } })
      expect(wrapper.text()).toContain(copy)
    }
  })

  it('uses two preview placeholders instead of a standalone hero', () => {
    const wrapper = mount(VariationProgress, { props: { phase: 'generating', candidates } })
    expect(wrapper.findAll('[data-response-placeholder]')).toHaveLength(2)
    expect(wrapper.find('h2').exists()).toBe(false)
  })

  it('keeps internal candidate details off the preview canvas', () => {
    const wrapper = mount(VariationProgress, { props: { phase: 'generating', candidates } })
    expect(wrapper.findAll('[data-candidate-status]')).toHaveLength(0)
    expect(wrapper.text()).not.toMatch(/candidate|direction/i)
  })

  it('announces progress politely without exposing candidate identifiers', () => {
    const wrapper = mount(VariationProgress, { props: { phase: 'generating', candidates } })
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('candidateId')
  })

  it('tells the user when automated comparison was limited', () => {
    const wrapper = mount(VariationProgress, {
      props: { phase: 'preparing', candidates, gradingMode: 'deterministic_fallback' },
    })
    expect(wrapper.text()).toContain('Automated comparison was limited')
  })
})
