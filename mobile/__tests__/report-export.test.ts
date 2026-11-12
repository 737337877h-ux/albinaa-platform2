import {beforeEach,describe,expect,it,jest} from '@jest/globals';
jest.mock('expo-file-system',()=>({File:jest.fn(),Paths:{cache:'cache://'}}));
jest.mock('expo-sharing',()=>({isAvailableAsync:jest.fn(),shareAsync:jest.fn()}));
jest.mock('../src/api/client',()=>({getClient:jest.fn()}));
import {File} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {getClient} from '../src/api/client';
import {exportReport} from '../src/utils/report-export';
describe('authorized report export',()=>{
 const create=jest.fn(),write=jest.fn(),get=jest.fn<any>();
 beforeEach(()=>{jest.clearAllMocks();(File as any).mockImplementation(()=>({create,write,uri:'cache://report.xlsx'}));(getClient as any).mockResolvedValue({get});(Sharing.isAvailableAsync as any).mockResolvedValue(true);});
 it('preserves XLSX binary bytes and shares only after a successful authenticated download',async()=>{
  const bytes=new Uint8Array([0x50,0x4b,3,4,0,255]);get.mockResolvedValue({data:bytes.buffer});
  await exportReport('/customers/without-phones.xlsx','report.xlsx');
  expect(get).toHaveBeenCalledWith('/customers/without-phones.xlsx',{responseType:'arraybuffer',timeout:60000});
  expect(write).toHaveBeenCalledWith(bytes);expect(Sharing.shareAsync).toHaveBeenCalledWith('cache://report.xlsx',expect.objectContaining({mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 });
 it('does not save or share on permission/network failures',async()=>{
  get.mockRejectedValue(new Error('403'));
  await expect(exportReport('/report','x.xlsx')).rejects.toThrow('403');
  expect(File).not.toHaveBeenCalled();expect(Sharing.shareAsync).not.toHaveBeenCalled();
 });
 it('rejects a login/error document returned in place of Excel',async()=>{
  get.mockResolvedValue({data:new Uint8Array([60,104,116,109,108]).buffer});
  await expect(exportReport('/report','x.xlsx')).rejects.toThrow('Excel');expect(write).not.toHaveBeenCalled();
 });
});
