import { createApp, defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShortcuts } from './useShortcuts'

const mountedApps: Array<ReturnType<typeof createApp>> = []

function mountShortcut(handler: (event: KeyboardEvent) => void | boolean) {
  const app = createApp(defineComponent({
    setup() {
      useShortcuts([{ keys: 'escape', description: 'Escape action', allowWhileEditing: true, handler }])
      return () => null
    },
  }))
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  mountedApps.push(app)
  return root
}

afterEach(() => {
  mountedApps.splice(0).forEach((app) => app.unmount())
  document.body.replaceChildren()
})

describe('useShortcuts', () => {
  it('consumes a handled shortcut', () => {
    const handler = vi.fn()
    mountShortcut(handler)
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    window.dispatchEvent(event)

    expect(handler).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('allows an unhandled shortcut to reach component keyboard handlers', () => {
    const handler = vi.fn(() => false)
    mountShortcut(handler)
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })

    window.dispatchEvent(event)

    expect(handler).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(false)
  })
})
