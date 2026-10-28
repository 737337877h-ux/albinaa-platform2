import { isOperationsApp } from './config/product';
export const colors = {
  primary: isOperationsApp ? '#075E50' : '#004D40',
  primarySoft: '#EDF3EF',
  secondary: '#00695C',
  gold: isOperationsApp ? '#BA9653' : '#D4AF37',
  goldDark: '#B18A24',
  goldLight: '#F7DC6F',
  goldSoft: '#F8F0D5',
  background: '#F5F7F6',
  surface: '#FFFFFF',
  ink: '#123832',
  muted: '#62766E',
  warmGray: '#AAB2B7',
  line: '#E1E8E4',
  danger: '#B9433D',
  dangerSoft: '#FCEBE9',
  success: '#17785E',
  warning: '#A46D13',
} as const;

export const radius = { sm: 12, md: 18, lg: 22, pill: 999 } as const;
export const fonts = { regular: 'TajawalRegular', medium: 'TajawalMedium', bold: 'TajawalBold' } as const;

export const shadow = {
  shadowColor: '#004D40',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.04,
  shadowRadius: 14,
  elevation: 1,
} as const;
