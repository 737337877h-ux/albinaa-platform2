import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../theme';
import { RequestPickerOption } from './request-search-picker';

export default function RequestUnitPickerModal({ visible, itemName, options, value, onSelect, onClose }:{
  visible: boolean;
  itemName?: string;
  options: RequestPickerOption[];
  value?: RequestPickerOption;
  onSelect: (option: RequestPickerOption) => void;
  onClose: () => void;
}) {
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.overlay}>
      <TouchableOpacity accessibilityLabel="إغلاق اختيار الوحدة" activeOpacity={1} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.close} onPress={onClose}><Ionicons name="close" size={21} color={colors.ink} /></TouchableOpacity>
          <View style={styles.headerText}><Text style={styles.title}>اختر الوحدة</Text>{itemName ? <Text numberOfLines={2} style={styles.itemName}>{itemName}</Text> : null}</View>
        </View>
        <View style={styles.options}>{options.map((option) => {
          const active = option.key === value?.key;
          return <TouchableOpacity key={option.key} style={[styles.option, active && styles.optionActive]} onPress={() => onSelect(option)}>
            <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={active ? colors.success : colors.muted} />
            <View style={styles.optionText}><Text style={styles.optionLabel}>{option.label}</Text>{option.hint ? <Text style={styles.optionHint}>{option.hint}</Text> : null}</View>
          </TouchableOpacity>;
        })}</View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay:{flex:1,backgroundColor:'rgba(4,17,16,.55)',justifyContent:'flex-end'},
  sheet:{backgroundColor:colors.surface,borderTopLeftRadius:22,borderTopRightRadius:22,padding:14,paddingBottom:24,...shadow},
  header:{flexDirection:'row',alignItems:'flex-start',minHeight:58},
  close:{width:40,height:40,borderRadius:999,backgroundColor:colors.primarySoft,alignItems:'center',justifyContent:'center'},
  headerText:{flex:1,paddingHorizontal:10},title:{ fontFamily: 'TajawalBold',color:colors.ink,textAlign:'right',fontSize:18,fontWeight:'900'},itemName:{ fontFamily: 'TajawalRegular',color:colors.muted,textAlign:'right',fontSize:13,marginTop:3},
  options:{gap:8},option:{minHeight:58,flexDirection:'row-reverse',alignItems:'center',gap:9,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,paddingHorizontal:12,backgroundColor:colors.background},optionActive:{borderColor:colors.primary,backgroundColor:colors.primarySoft},optionText:{flex:1},optionLabel:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,textAlign:'right',fontWeight:'900'},optionHint:{ fontFamily: 'TajawalRegular',color:colors.muted,textAlign:'right',fontSize:13,marginTop:2},
});
