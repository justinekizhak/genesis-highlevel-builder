import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CommandDialog from './CommandDialog.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CommandDialog', () => {
  it('gives the dialog an accessible name and description', async () => {
    const wrapper = mount(CommandDialog, {
      attachTo: document.body,
      props: { open: true },
      slots: { default: '<button type="button">Run command</button>' },
    })
    await nextTick()

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()

    const titleId = dialog?.getAttribute('aria-labelledby')
    const descriptionId = dialog?.getAttribute('aria-describedby')
    expect(titleId).toBeTruthy()
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(titleId!)?.textContent).toBe('Command palette')
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      'Search for and run a workspace command.',
    )

    wrapper.unmount()
  })
})
