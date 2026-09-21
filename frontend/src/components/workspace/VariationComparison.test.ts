import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VariationComparison from './VariationComparison.vue'
import type { VariationFinalist } from '@/types/generation'

function finalist(candidateId: string, displayName: 'Direction A' | 'Direction B'): VariationFinalist {
  return {
    candidateId,
    displayName,
    summary: `${displayName} keeps the contact list dominant.`,
    standout: `${displayName} keeps search visible while editing a contact.`,
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

  it('labels each action as a response so both read with the same weight', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    const labels = wrapper.findAll('[data-select-finalist]').map((button) => button.text())
    expect(labels).toEqual(['Use Response 1', 'Use Response 2'])
    expect(wrapper.text()).not.toMatch(/direction/i)
  })

  it('emits the chosen candidate id', async () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    await wrapper.findAll('[data-select-finalist]')[1]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['b']])
  })

  it('delegates opening a response so the workspace can attach the authenticated API bridge', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = mount(VariationComparison, { props: { finalists } })

    await wrapper.findAll('[data-open-new-tab]')[0]!.trigger('click')

    expect(wrapper.emitted('open-preview')).toEqual([[finalists[0]]])
  })

  it('keeps both previews mounted and disables both actions while selecting', () => {
    const wrapper = mount(VariationComparison, { props: { finalists, selectingCandidateId: 'a' } })
    expect(wrapper.findAll('iframe')).toHaveLength(2)
    expect(wrapper.findAll('[data-select-finalist]').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.text()).toContain('Applying Response 1')
  })

  it('surfaces a retryable response error without unmounting the previews', () => {
    const wrapper = mount(VariationComparison, { props: { finalists, error: 'Could not apply that direction.' } })
    expect(wrapper.find('[role="alert"]').text()).toContain('Could not apply that response.')
    expect(wrapper.find('[role="alert"]').text()).not.toMatch(/direction/i)
    expect(wrapper.findAll('iframe')).toHaveLength(2)
    expect(wrapper.findAll('[data-select-finalist]').every((button) => button.attributes('disabled') === undefined)).toBe(true)
  })

  it('normalizes generated evidence to response terminology', async () => {
    const withDirectionEvidence: [VariationFinalist, VariationFinalist] = [
      { ...finalists[0], standout: 'Direction A keeps search visible' },
      finalists[1],
    ]
    const wrapper = mount(VariationComparison, { props: { finalists: withDirectionEvidence }, attachTo: document.body })
    await wrapper.findAll('[data-evidence-trigger]')[0]!.trigger('click')
    expect(document.body.textContent).toContain('Response 1 keeps search visible')
    expect(document.body.textContent).not.toContain('Direction A keeps search visible')
    wrapper.unmount()
  })

  it('sandboxes every preview and never links active project files', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    for (const frame of wrapper.findAll('iframe')) {
      expect(frame.attributes('sandbox')).toBe('allow-scripts allow-forms')
      expect(frame.attributes('srcdoc')).toContain('Direction')
    }
  })

  it('shows a short standout line for the decision, not a full evidence list', async () => {
    const wrapper = mount(VariationComparison, { props: { finalists }, attachTo: document.body })
    await wrapper.findAll('[data-evidence-trigger]')[0]!.trigger('click')
    expect(document.body.textContent).toContain('Response 1 keeps search visible while editing a contact.')
    expect(document.body.querySelectorAll('.response-evidence-sheet li')).toHaveLength(0)
    wrapper.unmount()
  })

  it('gives every preview an accessible name and keyboard-reachable action', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    for (const button of wrapper.findAll('[data-select-finalist]')) {
      expect(button.element.tagName).toBe('BUTTON')
      expect(button.attributes('type')).toBe('button')
    }
    expect(wrapper.findAll('[data-response-panel]')).toHaveLength(2)
  })

  it('renders the two previews as equal full-height response panels', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    const panels = wrapper.findAll('[data-response-panel]')
    expect(panels).toHaveLength(2)
    expect(panels.map((panel) => panel.attributes('aria-label'))).toEqual(['Response 1', 'Response 2'])
    expect(wrapper.find('.variation-grid').exists()).toBe(true)
  })

  it('uses an overlay drawer for evidence instead of expanding the preview rows', async () => {
    const wrapper = mount(VariationComparison, { props: { finalists }, attachTo: document.body })

    expect(wrapper.findAll('[data-evidence-trigger]')).toHaveLength(2)
    expect(wrapper.findAll('details')).toHaveLength(0)
    await wrapper.findAll('[data-evidence-trigger]')[0]!.trigger('click')

    expect(document.body.textContent).toContain('Why Response 1 stands out')
    wrapper.unmount()
  })

  it('lets the user resize the two response previews with the keyboard', async () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    const separator = wrapper.get('[aria-label="Resize response previews"]')

    expect(separator.attributes('aria-valuenow')).toBe('50')
    await separator.trigger('keydown', { key: 'ArrowRight' })

    expect(separator.attributes('aria-valuenow')).toBe('53')
    expect(wrapper.get('.variation-grid').attributes('style')).toContain('--response-one-share: 53fr')
  })

  it('skips motion entirely when the viewer prefers reduced motion', () => {
    const wrapper = mount(VariationComparison, { props: { finalists } })
    expect(wrapper.find('.variation-stage-root').attributes('data-reduced-motion')).toBe('true')
  })
})
