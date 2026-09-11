import { describe, expect, it } from 'vitest'
import { highLevelOperations } from './proxy.js'

describe('HighLevel operation allowlist', () => {
  it('contains only the three assignment API areas', () => {
    expect(Object.keys(highLevelOperations)).toEqual([
      'contacts.list',
      'contacts.create',
      'contacts.update',
      'conversations.list',
      'conversations.messages',
      'conversations.send',
      'calendars.list',
      'calendars.availability',
      'appointments.list',
    ])
  })

  it('uses fixed server-owned paths', () => {
    for (const operation of Object.values(highLevelOperations)) {
      expect(operation.path).toMatch(/^\/(contacts|conversations|calendars)/)
      expect(['GET', 'POST', 'PUT']).toContain(operation.method)
    }
    expect(highLevelOperations['contacts.create']).toMatchObject({ method: 'POST', path: '/contacts/', location: 'body' })
    expect(highLevelOperations['contacts.update']).toMatchObject({ method: 'PUT', path: '/contacts/:contactId' })
    expect(highLevelOperations['conversations.send']).toMatchObject({ method: 'POST', path: '/conversations/messages' })
  })
})
