import React from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  const existing = Number.isFinite(Number(geoLat)) && Number.isFinite(Number(geoLng));
  const [point, setPoint] = React.useState({
    latitude: existing ? Number(geoLat) : DEFAULT_REGION.latitude,
    longitude: existing ? Number(geoLng) : DEFAULT_REGION.longitude,
  });
  const [loading, setLoading] = React.useState(!existing);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (existing) return;
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') { setLoading(false); return; }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPoint({ latitude: location.coords.latitude, longitude: location.coords.longitude });
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [existing]);

  const locateMe = async () => {
    setLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('صلاحية الموقع مطلوبة');
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setPoint({ latitude: location.coords.latitude, longitude: location.coords.longitude });
    } catch (error: any) { Alert.alert('تعذر تحديد الموقع', error?.message || 'تحقق من GPS'); }
    finally { setLoading(false); }
  };

  const mapHtml = `<!doctype html><html dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>html,body,#map{height:100%;margin:0;background:#e7f0ed}.leaflet-control-attribution{font-size:9px}</style></head><body><div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
    const lat=${point.latitude}; const lng=${point.longitude};
    const map=L.map('map').setView([lat,lng],16); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
    const marker=L.marker([lat,lng],{draggable:true}).addTo(map);
    function send(p){window.ReactNativeWebView.postMessage(JSON.stringify({latitude:p.lat,longitude:p.lng}));}
    map.on('click',e=>{marker.setLatLng(e.latlng);send(e.latlng)}); marker.on('dragend',()=>send(marker.getLatLng()));
    </script></body></html>`;

  const save = async () => {
    if (!customerId) return;
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

  return (
    <View style={styles.screen}>
      <View style={styles.help}><Text style={styles.helpText}>اضغط على الخريطة أو حرّك العلامة لتحديد موقع العميل بدقة.</Text></View>
      <WebView
        key={`${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`}
        style={styles.map}
        source={{ html: mapHtml }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={(event) => {
          try {
            const next = JSON.parse(event.nativeEvent.data);
            if (Number.isFinite(next.latitude) && Number.isFinite(next.longitude)) setPoint(next);
          } catch { /* ignore invalid map messages */ }
        }}
        renderLoading={() => <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text>جارٍ تحميل الخريطة…</Text></View>}
        startInLoadingState
      />
      <View style={styles.footer}>
        <Text style={styles.coords}>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</Text>
        <TouchableOpacity style={styles.locate} onPress={locateMe} disabled={loading}><Text style={styles.locateText}>{loading ? 'جارٍ تحديد الموقع…' : 'استخدام موقعي الحالي'}</Text></TouchableOpacity>
        <TouchableOpacity style={styles.save} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.saveText}>اعتماد موقع العميل</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  help: { backgroundColor: colors.goldSoft, padding: 12, borderBottomWidth: 1, borderColor: '#E8D7AE' },
  helpText: { color: colors.ink, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  map: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  footer: { backgroundColor: '#fff', padding: 14, borderTopWidth: 1, borderTopColor: colors.line, ...shadow },
  coords: { color: colors.muted, fontSize: 12, textAlign: 'center', marginBottom: 8 },
  locate: { borderWidth: 1, borderColor: colors.primary, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  locateText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  save: { backgroundColor: colors.gold, minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', ...shadow },
  saveText: { color: colors.primary, fontSize: 15, fontWeight: '900' },
});
