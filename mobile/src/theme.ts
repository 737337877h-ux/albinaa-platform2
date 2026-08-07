export const colors = {
  primary: '#103E3A',
  primarySoft: '#E7F0ED',
  secondary: '#1C665C',
  gold: '#C9A65B',
  goldSoft: '#F6EEDC',
  background: '#F7F6F1',
  surface: '#FFFFFF',
  ink: '#17312D',
  muted: '#6D7D79',
  line: '#E2E8E5',
  danger: '#B9433D',
  dangerSoft: '#FCEBE9',
  success: '#17785E',
  warning: '#A46D13',
} as const;

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

export const shadow = {
  shadowColor: '#103E3A',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 3,
} as const;
