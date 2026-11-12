import {File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {getClient} from '../api/client';

/** The authenticated API client retains normal expiry/refresh and scope checks. */
export async function exportReport(path:string,name:string){
 const response=await(await getClient()).get<ArrayBuffer>(path,{responseType:'arraybuffer',timeout:60000});
 const data=new Uint8Array(response.data);
 if(data[0]!==0x50||data[1]!==0x4b)throw new Error('لم يصل ملف Excel صالح؛ أعد المحاولة');
 const file=new File(Paths.cache,name);
 file.create({overwrite:true});file.write(data);
 if(!await Sharing.isAvailableAsync())throw new Error('مشاركة الملفات غير متاحة على هذا الهاتف');
 await Sharing.shareAsync(file.uri,{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',UTI:'org.openxmlformats.spreadsheetml.sheet',dialogTitle:'حفظ أو مشاركة التقرير'});
}
