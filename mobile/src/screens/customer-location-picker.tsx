import React from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseGeoPoint, GeoPoint } from '../utils/geo-point';
import * as Location from 'expo-location';
import { WebView } from 'react-native-webview';
import { enqueueMutation, updateCustomerLocationOffline } from '../db/database';
import { generateIdempotencyKey } from '../utils/constants';
import { colors, radius, shadow } from '../theme';

const DEFAULT_REGION = {
  latitude: 15.3694,
  longitude: 44.1910,
  latitudeDelta: 0.035,
  longitudeDelta: 0.035,
};

export default function CustomerLocationPickerScreen({ route, navigation }: any) {
  const { customerId, geoLat, geoLng } = route.params || {};
  const initial = React.useRef(parseGeoPoint(geoLat, geoLng)).current;
  const [coordinates, setCoordinates] = React.useState({ latitude: initial ? String(initial.latitude) : '', longitude: initial ? String(initial.longitude) : '' });
  const point = parseGeoPoint(coordinates.latitude, coordinates.longitude);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [locationMessage, setLocationMessage] = React.useState('');
  const [mapError, setMapError] = React.useState(false);
  const [mapLoading, setMapLoading] = React.useState(true);
  const [mapReady, setMapReady] = React.useState(false);
  const web = React.useRef<WebView>(null);
  const request = React.useRef(0);
  const choose = (value: GeoPoint) => setCoordinates({ latitude: String(value.latitude), longitude: String(value.longitude) });
  const locateMe = React.useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setLocationMessage('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('permission');
      if (!await Location.hasServicesEnabledAsync()) throw new Error('disabled');
      const location = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20000); }),
      ]);
      const selected = parseGeoPoint(location.coords.latitude, location.coords.longitude);
      if (!selected) throw new Error('invalid');
      if (current === request.current) {
        choose(selected);
        setLocationMessage(`تم تحديد الموقع${location.coords.accuracy != null ? ` — دقة تقريبية ${Math.round(location.coords.accuracy)} متر` : ''}. راجع العلامة قبل الاعتماد.`);
      }
    } catch (error: any) {
      if (current === request.current) setLocationMessage(error?.message === 'permission'
        ? 'اسمح للتطبيق بالوصول إلى الموقع من إعدادات الهاتف، ثم أعد المحاولة.'
        : error?.message === 'disabled' ? 'خدمة الموقع متوقفة. فعّلها من إعدادات الهاتف ثم أعد المحاولة.'
        : 'تعذر الحصول على موقع حالي. جرّب قرب نافذة أو في مكان مفتوح، أو حدد موقع العميل على الخريطة. لم يتم اختيار موقع بديل تلقائيًا.');
    } finally { if (timer) clearTimeout(timer); if (current === request.current) setLoading(false); }
  }, []);
  React.useEffect(() => { if (!initial) void locateMe(); return () => { request.current++; }; }, [initial, locateMe]);
  React.useEffect(() => {
    if (mapReady) web.current?.injectJavaScript(`window.setSelectedPoint && window.setSelectedPoint(${point?.latitude ?? 'null'},${point?.longitude ?? 'null'});true;`);
  }, [point?.latitude, point?.longitude, mapReady]);

  const mapHtml = React.useMemo(() => `<!doctype html><html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>html,body,#map{height:100%;margin:0;background:#e7f0ed}.leaflet-control-attribution{font-size:9px}</style></head><body><div id="map"></div>
    <script>function notify(data){window.ReactNativeWebView.postMessage(JSON.stringify(data));} window.onerror=function(){notify({type:'error'});};</script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="notify({type:'error'})"></script><script>
    const map=L.map('map').setView([${initial?.latitude ?? DEFAULT_REGION.latitude},${initial?.longitude ?? DEFAULT_REGION.longitude}],16);
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'});
    // The provider's secondary hostname remains reachable on some mobile networks.
    // Retry only visible tiles, never prefetch or download a region.
    function clearTileTimers(tile){clearTimeout(tile.retryTimer);clearTimeout(tile.failureTimer);}
    tiles.on('tileloadstart',({tile})=>{
      tile.retryTimer=setTimeout(()=>{if(!tile.complete||!tile.naturalWidth)tile.src=tile.src.replace('https://tile.openstreetmap.org/','https://b.tile.openstreetmap.org/');},6000);
      tile.failureTimer=setTimeout(()=>{if(!tile.complete||!tile.naturalWidth)notify({type:'error'});},18000);
    });
    tiles.on('tileload',({tile})=>clearTileTimers(tile));tiles.on('tileunload',({tile})=>clearTileTimers(tile));
    tiles.on('tileerror',()=>notify({type:'error'}));tiles.on('tileload',()=>notify({type:'loaded'}));
    tiles.addTo(map);
    let marker=null;
    window.setSelectedPoint=function(lat,lng){if(lat===null||lng===null){if(marker){map.removeLayer(marker);marker=null;}return;}
      if(!marker){marker=L.marker([lat,lng],{draggable:true}).addTo(map);marker.on('dragend',()=>send(marker.getLatLng()));}else marker.setLatLng([lat,lng]);
      map.panTo([lat,lng]);};
    function send(p){notify({type:'point',latitude:p.lat,longitude:p.lng});}
    map.on('click',e=>{window.setSelectedPoint(e.latlng.lat,e.latlng.lng);send(e.latlng)});
    notify({type:'ready'});
    </script></body></html>`, [initial]);

  const save = async () => {
    if (!customerId || !point || loading || saving) return;
    setSaving(true);
    try {
      await updateCustomerLocationOffline(String(customerId), point.latitude, point.longitude);
      await enqueueMutation(generateIdempotencyKey(), 'PATCH', `/mobile/customers/${customerId}/field-update`, {
        geoLat: point.latitude,
        geoLng: point.longitude,
      });
      Alert.alert('تم الحفظ محليًا', 'سيتم إرسال موقع العميل إلى النظام عند المزامنة التالية.', [
        { text: 'حسنًا', onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      Alert.alert('تعذر الحفظ', error?.message || 'حاول مرة أخرى');
    } finally { setSaving(false); }
  };

  const setCoordinate = (key: 'latitude' | 'longitude', value: string) => {
    request.current++; setLoading(false);
    setCoordinates((current) => ({ ...current, [key]: value }));
  };

  const openInGoogleMaps = async () => {
    if (!point) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.latitude},${point.longitude}`)}`;
    try { await Linking.openURL(url); } catch { Alert.alert('تعذر فتح الخريطة', 'تحقق من تثبيت Google Maps أو اتصال الإنترنت.'); }
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}><KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.help}><Text style={styles.helpText}>اضغط على الخريطة أو حرّك العلامة لتحديد موقع العميل بدقة.</Text></View>
      {mapLoading && !mapError && <Text style={styles.status}>جارٍ تحميل الخريطة…</Text>}
      {mapError && <TouchableOpacity style={styles.help} onPress={() => { setMapError(false); setMapLoading(true); setMapReady(false); web.current?.reload(); }}><Text style={styles.helpText}>تعذر تحميل الخريطة. تحقق من الإنترنت واضغط لإعادة التحميل.</Text></TouchableOpacity>}
      <WebView
        ref={web}
        style={styles.map}
        source={{ html: mapHtml, baseUrl: 'https://albinaa-map.local/' }}
        applicationNameForUserAgent="AlBinaaCollector/1.3"
        onError={() => setMapError(true)}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={(event) => {
          try {
            const next = JSON.parse(event.nativeEvent.data);
            if (next.type === 'ready') setMapReady(true);
            if (next.type === 'error') setMapError(true);
            if (next.type === 'loaded') { setMapError(false); setMapLoading(false); }
            const selected = parseGeoPoint(next.latitude, next.longitude);
            if (next.type === 'point' && selected) { request.current++; setLoading(false); choose(selected); setLocationMessage('موقع محدد يدويًا. راجعه قبل الاعتماد.'); }
          } catch { /* ignore invalid map messages */ }
        }}
        renderLoading={() => <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text>جارٍ تحميل الخريطة…</Text></View>}
        startInLoadingState
      />
      <View style={styles.footer}>
        {!!locationMessage && <Text style={styles.status}>{locationMessage}</Text>}
        {!point && <Text style={styles.status}>لم يُحدد موقع صالح بعد.</Text>}
        <View style={styles.coordinateRow}>
          <View style={styles.coordinateField}><Text style={styles.coordinateLabel}>خط العرض</Text><TextInput accessibilityLabel="خط العرض" value={coordinates.latitude} onChangeText={(value) => setCoordinate('latitude', value)} keyboardType="numbers-and-punctuation" style={styles.coordinateInput} /></View>
          <View style={styles.coordinateField}><Text style={styles.coordinateLabel}>خط الطول</Text><TextInput accessibilityLabel="خط الطول" value={coordinates.longitude} onChangeText={(value) => setCoordinate('longitude', value)} keyboardType="numbers-and-punctuation" style={styles.coordinateInput} /></View>
        </View>
        <TouchableOpacity style={[styles.mapsButton, !point && styles.disabled]} disabled={!point} onPress={openInGoogleMaps}><Text style={styles.mapsButtonText}>فتح الموقع المحدد في Google Maps</Text></TouchableOpacity>
        <TouchableOpacity style={styles.locate} onPress={locateMe} disabled={loading}><Text style={styles.locateText}>{loading ? 'جارٍ تحديد الموقع…' : 'استخدام موقعي الحالي'}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{disabled:!point || saving || loading}} style={[styles.save, (!point || saving || loading) && styles.disabled]} onPress={save} disabled={!point || saving || loading}>
          {saving ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.saveText}>اعتماد موقع العميل</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView></SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  status: { fontFamily: 'TajawalRegular', color: colors.ink, textAlign: 'right', fontSize: 13, marginBottom: 8 },
  disabled: { opacity: 0.4 },
  help: { backgroundColor: colors.goldSoft, padding: 12, borderBottomWidth: 1, borderColor: '#E8D7AE' },
  helpText: { fontFamily: 'TajawalBold', color: colors.ink, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  map: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  footer: { backgroundColor: '#fff', padding: 14, borderTopWidth: 1, borderTopColor: colors.line, ...shadow },
  coordinateRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 8 },
  coordinateField: { flex: 1 },
  coordinateLabel: { fontFamily: 'TajawalRegular', color: colors.muted, fontSize: 13, textAlign: 'right', marginBottom: 3 },
  coordinateInput: { fontFamily: 'TajawalRegular', minHeight: 40, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 8, color: colors.ink, textAlign: 'center', fontSize: 13 },
  mapsButton: { minHeight: 42, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  mapsButtonText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 13, fontWeight: '900' },
  locate: { borderWidth: 1, borderColor: colors.primary, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  locateText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 14, fontWeight: '900' },
  save: { backgroundColor: colors.gold, minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  saveText: { fontFamily: 'TajawalBold', color: colors.primary, fontSize: 16, fontWeight: '900' },
});
