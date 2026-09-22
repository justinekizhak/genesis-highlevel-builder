import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import VariationGradingDetails from './VariationGradingDetails.vue'

const brief = {
  id: 'candidate-a',
  title: 'Direction A',
  designIntent: 'A clear, hierarchy-first layout.',
  informationArchitecture: 'Single column with a sticky summary.',
  interactionModel: 'Click-through cards.',
  visualDirection: 'Warm neutral palette.',
  density: 'balanced' as const,
  differentiators: ['Sticky summary', 'Card-based navigation'],
}

const rubric = {
  featureFidelity: 28,
  functionalCorrectness: 22,
  robustness: 12,
  usability: 9,
  accessibility: 8,
  responsiveness: 4,
  maintainability: 5,
  standout: 'Uses a sticky summary bar.',
  evidence: [{ path: 'app.js' as const, detail: 'Implements the required search filter.' }],
}

describe('VariationGradingDetails', () => {
  it('renders rubric totals and brief when grading succeeded', () => {
    const wrapper = mount(VariationGradingDetails, {
      props: { label: 'Response 1', gradingMode: 'full', internalRank: 1, requestedCount: 4, eligibleCount: 4, brief, rubric },
    })
    expect(wrapper.text()).toContain('88/100')
    expect(wrapper.text()).toContain('4 of 4 independently generated candidates')
    expect(wrapper.text()).toContain('ranked #1')
    expect(wrapper.text()).toContain('Implements the required search filter.')
    expect(wrapper.text()).toContain('Sticky summary')
  })

  it('renders the fallback message and no rubric when grading fell back', () => {
    const wrapper = mount(VariationGradingDetails, {
      props: { label: 'Response 2', gradingMode: 'deterministic_fallback', brief },
    })
    expect(wrapper.text()).toContain('AI grader was unavailable')
    expect(wrapper.text()).not.toContain('Rubric score')
  })
})
