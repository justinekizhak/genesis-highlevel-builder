import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VariationComparison from './VariationComparison.vue'
import type { VariationFinalist } from '@/types/generation'

function finalist(candidateId: string, displayName: 'Direction A' | 'Direction B'): VariationFinalist {
  return {
    candidateId,
    displayName,
    summary: `${displayName} keeps the contact list dominant.`,
    strengths: ['Scannable rows', 'Search stays visible', 'Clear empty state', 'Extra strength'],
    risks: ['Dense on mobile', 'No bulk actions', 'Long names truncate', 'Extra risk'],
    files: {
      'index.html': { path: 'index.html', language: 'html', content: `<main>${displayName}</main>` },
      'styles.css': { path: 'styles.css', language: 'css', content: 'body{}' },
      'app.js': { path: 'app.js', language: 'javascript', content: '// x' },
    },
  }
}

const finalists: [VariationFinalist, VariationFinalist] = [
  finalist('a', 'Direction A'),
  finalist('b', 'Direction B'),
]

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

describe('VariationComparison', () => {
  it('offers equal selection actions without revealing internal rank', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    expect(wrapper.findAll('[data-select-finalist]')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('Recommended')
    expect(wrapper.text()).not.toMatch(/Score:\s*\d+/)
    expect(wrapper.text()).not.toContain('internalRank')
  })

  it('labels each action with its direction so both read the same weight', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    const labels = wrapper.findAll('[data-select-finalist]').map((button) => button.text())
    expect(labels).toEqual(['Use Direction A', 'Use Direction B'])
  })

  it('emits the chosen candidate id', async () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    await wrapper.findAll('[data-select-finalist]')[1]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['b']])
  })

  it('keeps both previews mounted and disables both actions while selecting', () => {
    const wrapper = mount(VariationComparison, { props: { finalists, selectingCandidateId: 'a' } })
    expect(wrapper.findAll('iframe')).toHaveLength(2)
    expect(wrapper.findAll('[data-select-finalist]').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.text()).toContain('Applying Direction A')
  })

  it('surfaces a retryable error without unmounting the previews', () => {
    const wrapper = mount(VariationComparison, { props: { finalists, error: 'Could not apply that direction.' } })
    expect(wrapper.find('[role="alert"]').text()).toContain('Could not apply that direction.')
    expect(wrapper.findAll('iframe')).toHaveLength(2)
    expect(wrapper.findAll('[data-select-finalist]').every((button) => button.attributes('disabled') === undefined)).toBe(true)
  })

  it('sandboxes every preview and never links active project files', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    for (const frame of wrapper.findAll('iframe')) {
      expect(frame.attributes('sandbox')).toBe('allow-scripts allow-forms')
      expect(frame.attributes('srcdoc')).toContain('Direction')
    }
  })

  it('limits visible strengths and risks to three each', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    expect(wrapper.text()).not.toContain('Extra strength')
    expect(wrapper.text()).not.toContain('Extra risk')
  })

  it('gives every preview an accessible name and keyboard-reachable action', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    for (const button of wrapper.findAll('[data-select-finalist]')) {
      expect(button.element.tagName).toBe('BUTTON')
      expect(button.attributes('type')).toBe('button')
    }
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2)
  })

  it('skips motion entirely when the viewer prefers reduced motion', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    expect(wrapper.find('.variation-stage-root').attributes('data-reduced-motion')).toBe('true')
  })
})
