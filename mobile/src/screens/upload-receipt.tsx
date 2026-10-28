import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { uploadReceipt } from '../api/endpoints';
import { pickFromCamera, pickFromGallery } from '../utils/image';
import { colors, radius, shadow } from '../theme';

export default function UploadReceiptScreen({ route, navigation }: any) {
  const collectionId = route.params?.collectionId || '';
  const [imageUri, setImageUri] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!imageUri) throw new Error('No image');
      return uploadReceipt(imageUri, collectionId);
    },
    onSuccess: () => {
      Alert.alert('تم', 'تم رفع السند بنجاح');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('خطأ', err.response?.data?.message || 'فشل رفع السند');
    },
  });

  const handleCamera = async () => {
    const uri = await pickFromCamera();
    if (uri) setImageUri(uri);
  };

  const handleGallery = async () => {
    const uri = await pickFromGallery();
    if (uri) setImageUri(uri);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>رفع سند التحصيل</Text>

      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.preview} />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>اختر صورة السند</Text>
        </View>
      )}

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.cameraBtn} onPress={handleCamera}>
          <Text style={styles.btnText}>📷 تصوير</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.galleryBtn} onPress={handleGallery}>
          <Text style={styles.btnText}>🖼 معرض</Text>
        </TouchableOpacity>
      </View>

      {imageUri && (
        <TouchableOpacity
          style={[styles.uploadBtn, mutation.isPending && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          <Text style={styles.uploadText}>{mutation.isPending ? 'جارٍ الرفع...' : 'رفع السند'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  title: { fontFamily: 'TajawalBold', fontSize: 20, fontWeight: '900', color: colors.primary, textAlign: 'center', marginBottom: 24 },
  preview: { width: '100%', height: 300, borderRadius: radius.md, marginBottom: 16 },
  placeholder: { width: '100%', height: 300, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', alignItems: 'center', marginBottom: 16, ...shadow },
  placeholderText: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 16 },
  buttons: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  cameraBtn: { flex: 1, backgroundColor: colors.primary, padding: 16, borderRadius: radius.md, alignItems: 'center' },
  galleryBtn: { flex: 1, backgroundColor: colors.gold, padding: 16, borderRadius: radius.md, alignItems: 'center' },
  btnText: { fontFamily: 'TajawalBold', color: colors.surface, fontSize: 16, fontWeight: '800' },
  uploadBtn: { backgroundColor: colors.gold, padding: 18, borderRadius: radius.md, alignItems: 'center', ...shadow },
  disabled: { opacity: 0.6 },
  uploadText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 18, fontWeight: '900' },
});
