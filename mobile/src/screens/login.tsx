import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../store/auth-context';
import { getBaseUrl } from '../config/api';

export default function LoginScreen({ navigation }: any) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');

  React.useEffect(() => {
    (async () => { setCurrentUrl(await getBaseUrl()); })();
  }, []);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      Alert.alert('تنبيه', 'يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      const msg = err.response?.data?.message?.[0] || err.response?.data?.message || 'فشل تسجيل الدخول';
      Alert.alert('خطأ', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.logo}>البناء الراقي</Text>
        <Text style={styles.subtitle}>نظام إدارة المديونية والتحصيل</Text>
        <TextInput
          style={styles.input}
          placeholder="اسم المستخدم"
          placeholderTextColor="#999"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="كلمة المرور"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.serverLink} onPress={() => navigation.navigate('ServerSettings')}>
          <Text style={styles.serverLinkText}>⚙ {currentUrl || 'تغيير الخادم'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', backgroundColor: '#f0f4f8', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 32, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  logo: { fontSize: 28, fontWeight: 'bold', color: '#1a73e8', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 32 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16, color: '#333', textAlign: 'right' },
  button: { backgroundColor: '#1a73e8', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  serverLink: { marginTop: 16, padding: 10, alignItems: 'center' },
  serverLinkText: { color: '#1a73e8', fontSize: 13 },
});
