export const highLevelOperations = [
  'contacts.list',
  'conversations.list',
  'conversations.messages',
  'calendars.list',
  'appointments.list',
] as const

export type HighLevelOperation = typeof highLevelOperations[number]

export type HighLevelParameters = Record<string, string | number | undefined>

export const highLevelOperationSet = new Set<string>(highLevelOperations)
