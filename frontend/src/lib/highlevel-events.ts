export const HL_EVENT_LABELS: Record<string, string> = {
  ContactCreate: 'New contact created',
  ContactUpdate: 'Contact updated',
  ContactDelete: 'Contact deleted',
  InboundMessage: 'New message received',
  AppointmentCreate: 'New appointment booked',
  AppointmentUpdate: 'Appointment updated',
}

export function hlEventLabel(type: string): string {
  return HL_EVENT_LABELS[type] ?? type
}
