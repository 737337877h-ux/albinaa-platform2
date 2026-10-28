import { StyleSheet } from 'react-native';
import { colors, fonts, radius } from '../theme';

/** Shared visual treatment only; screens retain their own handlers and layout. */
export const requestActionStyles = StyleSheet.create({
  primary: { minHeight: 52, borderRadius: radius.sm, backgroundColor: colors.gold, paddingHorizontal: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
  secondary: { minHeight: 52, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
});
