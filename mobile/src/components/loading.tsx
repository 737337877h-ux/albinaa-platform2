import React from 'react';
import { View, ActivityIndicator, Image, Text, StyleSheet } from 'react-native';
import brandIcon from '../../assets/albinaa-collection-icon.png';

interface LoadingProps {
  message?: string;
}

export default function Loading({ message = 'جارٍ التحميل...' }: LoadingProps) {
  return (
    <View style={styles.container}>
      <Image source={brandIcon} style={styles.logo} resizeMode="contain" />
      <Text style={styles.brand}>البناء الراقي تحصيل</Text>
      <Text style={styles.tagline}>أساس تثق فيه</Text>
      <ActivityIndicator size="small" color="#F7A928" style={styles.spinner} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  logo: { width: 190, height: 190 },
  brand: { fontSize: 26, fontWeight: '800', color: '#123F73', marginTop: 4 },
  tagline: { fontSize: 16, fontWeight: '600', color: '#123F73', marginTop: 8 },
  spinner: { marginTop: 28 },
  text: { marginTop: 10, fontSize: 13, color: '#667A74' },
});
