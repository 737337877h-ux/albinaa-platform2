import React from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, ScrollView, Modal, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAudioPlayer } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

export default function RequestBarcodeScanner({ visible, onClose, onScanned }:{
  visible: boolean;
  onClose: () => void;
  onScanned: (value: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = React.useState(false);
  const [cameraMounted, setCameraMounted] = React.useState(false);
  const [cameraReady, setCameraReady] = React.useState(false);
  const [cameraError, setCameraError] = React.useState('');
  const [cameraKey, setCameraKey] = React.useState(0);
  const [manualCode, setManualCode] = React.useState('');
  const [appActive, setAppActive] = React.useState(AppState.currentState === 'active');
  const lockedRef = React.useRef(false);
  // Expo resolves bundled audio assets through the static module id returned by require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const scanPlayer = useAudioPlayer(require('../../assets/sounds/barcode_scanner_beep.ogg'));

  React.useEffect(() => {
    if (visible) {
      lockedRef.current = false;
      setLocked(false);
      setCameraReady(false);
      setCameraError('');
      setManualCode('');
    } else {
      setCameraMounted(false);
    }
  }, [visible]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  React.useEffect(() => {
    if (!visible || !permission?.granted || !appActive) {
      setCameraMounted(false);
      return;
    }
    // Some Android devices return a black preview when CameraView is mounted
    // in the same frame as the transparent modal. Let the modal finish first.
    const timer = setTimeout(() => setCameraMounted(true), 220);
    return () => clearTimeout(timer);
  }, [appActive, cameraKey, permission?.granted, visible]);

  const accept = (data: string) => {
    const value = data.trim();
    if (!value || lockedRef.current) return;
    // The camera may emit the same frame more than once before React applies
    // setState. A synchronous ref closes that window and avoids duplicate
    // item lookups/alerts that made the scanner appear frozen.
    lockedRef.current = true;
    setLocked(true);
    Vibration.vibrate(45);
    try {
      scanPlayer.seekTo(0);
      scanPlayer.play();
    } catch {
      // Reading must continue even if the phone has disabled application audio.
    }
    setCameraMounted(false);
    onScanned(value);
    onClose();
  };

  const retryCamera = () => {
    setCameraMounted(false);
    setCameraReady(false);
    setCameraError('');
    setCameraKey((value) => value + 1);
  };

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.overlay}>
      <TouchableOpacity accessibilityLabel="إغلاق قارئ الباركود" activeOpacity={1} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.card}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.close}><Ionicons name="close" size={22} color={colors.ink} /></TouchableOpacity>
          <View style={styles.headerText}><Text style={styles.title}>قراءة باركود الصنف</Text><Text style={styles.subtitle}>وجّه الكاميرا إلى باركود الصنف</Text></View>
        </View>
        {!permission?.granted ? <View style={styles.permission}>
          <Ionicons name="camera-outline" size={42} color={colors.primary} />
          <Text style={styles.permissionText}>اسمح بالكاميرا لقراءة الباركود.</Text>
          <TouchableOpacity style={styles.allow} onPress={requestPermission}><Text style={styles.allowText}>السماح بالكاميرا</Text></TouchableOpacity>
        </View> : <View style={styles.cameraWrap}>
          {visible && cameraMounted && !cameraError ? <CameraView key={cameraKey} style={StyleSheet.absoluteFill} active={visible && appActive} facing="back" barcodeScannerSettings={{ barcodeTypes: ['code128', 'code39', 'ean13', 'ean8', 'upc_a', 'upc_e', 'qr'] }} onCameraReady={() => setCameraReady(true)} onMountError={(event) => { setCameraReady(false); setCameraError(event.message || 'تعذر تشغيل الكاميرا'); }} onBarcodeScanned={locked ? undefined : ({ data }) => accept(data)} /> : null}
          {!cameraReady && !cameraError ? <View style={styles.cameraState}><ActivityIndicator color="#fff" /><Text style={styles.cameraStateText}>{appActive ? 'جارٍ تشغيل الكاميرا…' : 'ارجع إلى التطبيق لتشغيل الكاميرا'}</Text></View> : null}
          {cameraError ? <View style={styles.cameraState}><Ionicons name="camera-reverse-outline" size={38} color="#fff" /><Text style={styles.cameraStateText}>{cameraError}</Text><TouchableOpacity style={styles.retry} onPress={retryCamera}><Text style={styles.retryText}>إعادة تشغيل الكاميرا</Text></TouchableOpacity></View> : null}
          {cameraReady ? <View pointerEvents="none" style={styles.frame}><View style={styles.target} /></View> : null}
        </View>}
        <View style={styles.hintRow}><Ionicons name="scan-outline" size={18} color={colors.primary} /><Text style={styles.hint}>ضع الرمز داخل الإطار؛ ستسمع نغمة عند نجاح القراءة</Text></View>
        <View style={styles.manualRow}><TouchableOpacity disabled={!manualCode.trim()} style={[styles.manualButton,!manualCode.trim()&&styles.manualButtonDisabled]} onPress={() => accept(manualCode)}><Text style={styles.manualButtonText}>اعتماد</Text></TouchableOpacity><TextInput value={manualCode} onChangeText={setManualCode} onSubmitEditing={() => accept(manualCode)} returnKeyType="done" placeholder="أو أدخل الباركود يدويًا" placeholderTextColor={colors.muted} style={styles.manualInput} textAlign="right" /></View>
      </View>
    </ScrollView></KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay:{flexGrow:1,backgroundColor:colors.background,alignItems:'center',justifyContent:'center',padding:20},
  card:{width:'100%',maxWidth:430,backgroundColor:colors.surface,borderRadius:radius.md,borderWidth:1,borderColor:colors.line,overflow:'hidden'},
  header:{minHeight:64,flexDirection:'row',alignItems:'center',paddingHorizontal:10},
  close:{width:42,height:42,alignItems:'center',justifyContent:'center',borderRadius:999,backgroundColor:colors.primarySoft},
  headerText:{flex:1,paddingHorizontal:8},title:{ fontFamily: 'TajawalBold',color:colors.ink,textAlign:'right',fontSize:18,fontWeight:'900'},subtitle:{ fontFamily: 'TajawalRegular',color:colors.muted,textAlign:'right',fontSize:13,marginTop:2},
  permission:{height:230,alignItems:'center',justifyContent:'center',padding:20,gap:12},permissionText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'800',textAlign:'center'},allow:{minHeight:46,borderRadius:radius.sm,backgroundColor:colors.primary,paddingHorizontal:22,alignItems:'center',justifyContent:'center'},allowText:{ fontFamily: 'TajawalBold', fontSize: 15,color:'#fff',fontWeight:'900'},
  cameraWrap:{height:230,marginHorizontal:10,borderRadius:radius.sm,overflow:'hidden',backgroundColor:'#081C1A'},frame:{position:'absolute',top:0,right:0,bottom:0,left:0,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(0,0,0,.12)'},target:{width:'82%',height:116,borderWidth:3,borderColor:'#fff',borderRadius:radius.sm},
  cameraState:{position:'absolute',top:0,right:0,bottom:0,left:0,alignItems:'center',justifyContent:'center',gap:10,backgroundColor:'#081C1A',padding:18},cameraStateText:{ fontFamily: 'TajawalBold', fontSize: 15,color:'#fff',textAlign:'center',fontWeight:'800'},retry:{minHeight:40,borderRadius:radius.sm,backgroundColor:'#fff',paddingHorizontal:15,alignItems:'center',justifyContent:'center'},retryText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.primary,fontWeight:'900'},
  hintRow:{minHeight:54,flexDirection:'row-reverse',alignItems:'center',justifyContent:'center',gap:7,paddingHorizontal:12},hint:{ fontFamily: 'TajawalBold',flexShrink:1,color:colors.muted,textAlign:'center',fontSize:13,fontWeight:'800'},
  manualRow:{flexDirection:'row',gap:7,paddingHorizontal:10,paddingBottom:10},manualInput:{flex:1,minHeight:45,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:11,color:colors.ink},manualButton:{minWidth:72,minHeight:45,borderRadius:radius.sm,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center'},manualButtonDisabled:{opacity:.4},manualButtonText:{ fontFamily: 'TajawalBold', fontSize: 15,color:'#fff',fontWeight:'900'},
});
