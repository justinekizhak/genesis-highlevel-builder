export const highLevelOperations = [
  'contacts.list',
  'contacts.create',
  'contacts.update',
  'conversations.list',
  'conversations.messages',
  'conversations.send',
  'calendars.list',
  'calendars.availability',
  'appointments.list',
] as const

export type HighLevelOperation = typeof highLevelOperations[number]

export type HighLevelParameters = Record<string, string | number | boolean | string[] | undefined>

export const highLevelOperationSet = new Set<string>(highLevelOperations)
export const highLevelWriteOperationSet = new Set<HighLevelOperation>([
  'contacts.create',
  'contacts.update',
  'conversations.send',
])
