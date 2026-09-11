import { describe, expect, it } from 'vitest'
import { highLevelOperations, validateHighLevelParameters } from './proxy.js'

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

  it('requires the HighLevel calendar event date range and owner selector', () => {
    expect(() => validateHighLevelParameters('appointments.list', { limit: 20 })).toThrow(/startTime and endTime/)
    expect(() => validateHighLevelParameters('appointments.list', {
      startTime: '1767225600000',
      endTime: '1769817600000',
    })).toThrow(/calendarId, userId, or groupId/)
    expect(() => validateHighLevelParameters('appointments.list', {
      calendarId: 'calendar-1',
      startTime: '1767225600000',
      endTime: '1769817600000',
    })).not.toThrow()
  })
})
