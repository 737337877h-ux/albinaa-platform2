import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import RequestSearchPicker, { RequestPickerOption } from './request-search-picker';
import { colors, radius, shadow } from '../theme';

export type RequestItemLine = {
  id: string;
  item?: RequestPickerOption;
  unit?: RequestPickerOption;
  units: RequestPickerOption[];
  quantity: string;
  expanded: boolean;
};

function sizeLabel(option?: RequestPickerOption) {
  const raw = option?.raw as any;
  return raw?.sizeName ?? raw?.size ?? raw?.itemSize ?? 'يظهر ضمن وصف الصنف';
}

export default function RequestItemCard({ index, line, itemOptions, itemsLoading, quantityLabel, removable, onSearch, onScan, onItem, onOpenUnit, onQuantity, onQuantityFocus, onQuantitySubmit, onQuantityRef, onEdit, onRemove, onClear, preview }:{
  index:number; line:RequestItemLine; itemOptions:RequestPickerOption[]; itemsLoading?:boolean; quantityLabel:string; removable:boolean;
  onSearch:(value:string)=>void; onScan:()=>void; onItem:(option:RequestPickerOption)=>void; onOpenUnit:()=>void; onQuantity:(value:string)=>void; onQuantityFocus?:()=>void;
  onQuantitySubmit?:()=>void; onQuantityRef?:(input:TextInput|null)=>void; onEdit?:()=>void; onRemove:()=>void; onClear:()=>void; preview?:string;
}) {
  if (!line.item) {
    return <View style={styles.card}>
      <Text style={styles.emptyTitle}>{index + 1}. اختر الصنف</Text>
      <View style={styles.searchBody}>
        <RequestSearchPicker label="بحث بالاسم أو المقاس أو الكود" value={line.item} options={itemOptions} loading={itemsLoading} onSearchChange={onSearch} onSelect={onItem} onBarcodePress={onScan} />
      </View>
    </View>;
  }

  if (!line.expanded) {
    return <TouchableOpacity style={[styles.card, styles.collapsed]} onPress={onEdit}>
      <Ionicons name="create-outline" size={20} color={colors.primary} />
      <View style={styles.headerText}><Text numberOfLines={2} style={styles.name}>{index + 1}. {line.item.label}</Text><Text style={styles.meta}>{line.quantity} {line.unit?.label ?? ''} · {line.item.key}</Text></View>
      <Ionicons name="checkmark-circle" size={22} color={colors.success} />
    </TouchableOpacity>;
  }

  return <View style={styles.card}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text numberOfLines={2} style={styles.name}>{index + 1}. {line.item.label}</Text>
        <Text numberOfLines={1} style={styles.meta}>كود: {line.item.key} · المقاس: {sizeLabel(line.item)}</Text>
      </View>
      <TouchableOpacity accessibilityLabel="حذف الصنف" style={styles.clear} onPress={removable?onRemove:onClear}><Ionicons name="close" size={22} color={colors.danger}/></TouchableOpacity>
    </View>
    <View style={styles.body}>
      <View style={styles.grid}>
        <View style={styles.cell}><Text style={styles.label}>الوحدة</Text><TouchableOpacity style={styles.unitButton} onPress={onOpenUnit}><Ionicons name="chevron-down" size={17} color={colors.muted}/><Text style={[styles.unitText,!line.unit&&styles.unitPlaceholder]}>{line.unit?.label??'اختر الوحدة'}</Text></TouchableOpacity></View>
        <View style={styles.cell}><Text style={styles.label}>{quantityLabel}</Text><TextInput ref={onQuantityRef} value={line.quantity} onChangeText={onQuantity} onFocus={onQuantityFocus} keyboardType="decimal-pad" enterKeyHint="done" returnKeyType="done" blurOnSubmit={false} onSubmitEditing={onQuantitySubmit} selectTextOnFocus textAlign="right" style={styles.input} /></View>
      </View>
      {preview ? <Text style={styles.preview}>{preview}</Text> : null}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,marginBottom:8,...shadow},
  collapsed:{minHeight:66,flexDirection:'row-reverse',alignItems:'center',gap:9,paddingHorizontal:12},
  emptyTitle:{ fontFamily: 'TajawalBold',color:colors.ink,textAlign:'right',fontWeight:'900',fontSize:16,paddingHorizontal:12,paddingTop:10},
  searchBody:{paddingHorizontal:10,paddingTop:5,paddingBottom:8},
  header:{minHeight:58,flexDirection:'row-reverse',alignItems:'center',paddingHorizontal:9,paddingTop:8},
  clear:{width:38,height:38,alignItems:'center',justifyContent:'center'},
  headerText:{flex:1},
  name:{ fontFamily: 'TajawalBold',color:colors.ink,textAlign:'right',fontWeight:'900',fontSize:16,lineHeight:21},
  meta:{ fontFamily: 'TajawalRegular',color:colors.muted,textAlign:'right',fontSize:13,marginTop:2},
  body:{paddingHorizontal:9,paddingTop:5,paddingBottom:9},
  grid:{flexDirection:'row-reverse',gap:8},
  cell:{flex:1},
  label:{ fontFamily: 'TajawalBold',color:colors.ink,fontWeight:'800',textAlign:'right',fontSize:13,marginBottom:4},
  input:{minHeight:46,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:12,color:colors.ink},
  unitButton:{minHeight:46,flexDirection:'row',alignItems:'center',gap:7,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:10},unitText:{ fontFamily: 'TajawalBold', fontSize: 15,flex:1,color:colors.ink,textAlign:'right',fontWeight:'800'},unitPlaceholder:{color:colors.muted},
  preview:{ fontFamily: 'TajawalBold', fontSize: 15,backgroundColor:colors.primarySoft,color:colors.success,borderRadius:radius.sm,padding:8,textAlign:'right',fontWeight:'800',marginTop:7},
});
