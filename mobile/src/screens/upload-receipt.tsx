import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { uploadReceipt } from '../api/endpoints';
import { pickFromCamera, pickFromGallery } from '../utils/image';

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
  container: { flex: 1, backgroundColor: '#f0f4f8', padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#333', textAlign: 'center', marginBottom: 24 },
  preview: { width: '100%', height: 300, borderRadius: 12, marginBottom: 16 },
  placeholder: { width: '100%', height: 300, borderRadius: 12, backgroundColor: '#e0e0e0', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  placeholderText: { color: '#999', fontSize: 16 },
  buttons: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  cameraBtn: { flex: 1, backgroundColor: '#1a73e8', padding: 16, borderRadius: 12, alignItems: 'center' },
  galleryBtn: { flex: 1, backgroundColor: '#34a853', padding: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  uploadBtn: { backgroundColor: '#ea4335', padding: 18, borderRadius: 12, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  uploadText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
