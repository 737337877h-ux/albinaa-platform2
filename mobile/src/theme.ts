export const colors = {
  primary: '#004D40',
  primarySoft: '#E7F0ED',
  secondary: '#00695C',
  gold: '#D4AF37',
  goldDark: '#B18A24',
  goldLight: '#F7DC6F',
  goldSoft: '#F8F0D5',
  background: '#F8F9FA',
  surface: '#FFFFFF',
  ink: '#123832',
  muted: '#6F7D81',
  warmGray: '#AAB2B7',
  line: '#E0E5E7',
  danger: '#B9433D',
  dangerSoft: '#FCEBE9',
  success: '#17785E',
  warning: '#A46D13',
} as const;

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

export const shadow = {
  shadowColor: '#004D40',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 3,
} as const;
