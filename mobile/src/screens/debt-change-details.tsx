import React from 'react';
import { SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius } from '../theme';

export default function DebtChangeDetailsScreen({ route, navigation }: any) {
  const value = route.params?.value;
  const sections = Object.entries(value?.perCurrency ?? {}).map(([currency, row]: any) => ({
    title: currency,
    data: row.affectedAccounts ?? [],
  }));
  return <SectionList style={styles.screen} contentContainerStyle={styles.content} sections={sections}
    keyExtractor={(item, index) => `${item.customerId}-${item.currencyCode}-${index}`}
    ListHeaderComponent={<View style={styles.notice}><Text style={styles.noticeText}>الوارد يزيد مديونية الحساب، والمنصرف يخفضها، وذلك من حركات المنصة خلال آخر 24 ساعة.</Text></View>}
    ListEmptyComponent={<Text style={styles.empty}>لا توجد حسابات متأثرة ضمن نطاقك.</Text>}
    renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
    renderItem={({ item }) => <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Customer360', { id: item.customerId })}>
      <View style={styles.row}><View style={styles.changeGroup}><Text style={[styles.change, item.change < 0 && styles.decrease]}>{Math.abs(Number(item.change)).toLocaleString('en-US')}</Text><Text style={[styles.direction, item.change < 0 && styles.decrease]}>{item.change >= 0 ? 'وارد' : 'منصرف'}</Text></View><View style={styles.main}><Text style={styles.name}>{item.customerName}</Text><Text style={styles.code}>{item.customerCode}</Text></View></View>
      <View style={styles.balances}><Text style={styles.balance}>الحالي: {Number(item.currentBalance).toLocaleString('en-US')}</Text><Text style={styles.balance}>السابق: {Number(item.previousBalance).toLocaleString('en-US')}</Text></View>
    </TouchableOpacity>} />;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:colors.background},content:{padding:14,paddingBottom:44},notice:{backgroundColor:colors.primarySoft,borderRadius:radius.md,padding:12,marginBottom:10},noticeText:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,textAlign:'right',fontWeight:'800',lineHeight:21},section:{ fontFamily: 'TajawalBold',color:colors.primary,fontSize:18,fontWeight:'900',textAlign:'right',paddingVertical:9},card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:13,marginBottom:8},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10},main:{flex:1},name:{ fontFamily: 'TajawalBold', fontSize: 15,color:colors.ink,fontWeight:'900',textAlign:'right'},code:{color:colors.muted,textAlign:'right',marginTop:3},changeGroup:{alignItems:'flex-start'},change:{ fontFamily: 'TajawalBold',color:colors.danger,fontWeight:'900',fontSize:18},direction:{ fontFamily: 'TajawalBold',color:colors.danger,fontSize:13,fontWeight:'900'},decrease:{color:colors.success},balances:{flexDirection:'row',justifyContent:'space-between',borderTopWidth:1,borderTopColor:colors.line,marginTop:10,paddingTop:8},balance:{ fontFamily: 'TajawalRegular',color:colors.muted,fontSize:13},empty:{color:colors.muted,textAlign:'center',padding:30}});
