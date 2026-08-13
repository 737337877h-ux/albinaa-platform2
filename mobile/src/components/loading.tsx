import React from 'react';
import { View, ActivityIndicator, Image, Text, StyleSheet } from 'react-native';
import brandIcon from '../../assets/alraqi-header-flat-approved.png';
import { colors } from '../theme';

interface LoadingProps {
  message?: string;
}

export default function Loading({ message = 'جارٍ التحميل...' }: LoadingProps) {
  return (
    <View style={styles.container}>
      <Image source={brandIcon} style={styles.logo} resizeMode="contain" />
      <Text style={styles.brand}>ALRAQi ERP</Text>
      <Text style={styles.tagline}>إدارة المديونية والتحصيل</Text>
      <ActivityIndicator size="small" color={colors.gold} style={styles.spinner} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  logo: { width: 230, height: 205 },
  brand: { fontSize: 22, fontWeight: '900', color: colors.primary, marginTop: 4 },
  tagline: { fontSize: 15, fontWeight: '500', color: colors.muted, marginTop: 5 },
  spinner: { marginTop: 28 },
  text: { marginTop: 10, fontSize: 13, color: colors.muted },
});
