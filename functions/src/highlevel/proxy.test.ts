import { describe, expect, it } from 'vitest'
import { highLevelOperations } from './proxy.js'

describe('HighLevel operation allowlist', () => {
  it('contains only the three assignment API areas', () => {
    expect(Object.keys(highLevelOperations)).toEqual([
      'contacts.list',
      'conversations.list',
      'conversations.messages',
      'calendars.list',
      'appointments.list',
    ])
  })

  it('uses fixed server-owned paths', () => {
    for (const operation of Object.values(highLevelOperations)) {
      expect(operation.path).toMatch(/^\/(contacts|conversations|calendars)/)
      expect(operation.method).toBe('GET')
    }
  })
})
