import React from 'react';
import {beforeEach,describe,expect,it,jest} from '@jest/globals';
let mockLanOnly=true;
jest.mock('react-native',()=>({
 ...Object.fromEntries(['View','Text','TextInput','TouchableOpacity','KeyboardAvoidingView','Modal','ActivityIndicator','ScrollView','Image','Switch'].map(name=>[name,name])),
 StyleSheet:{create:(value:any)=>value},Platform:{OS:'android'},Alert:{alert:jest.fn()},
}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('../assets/alraqi-header-flat-approved.png',()=>1);
jest.mock('../src/theme',()=>({colors:{},radius:{},shadow:{}}));
jest.mock('../src/config/product',()=>({product:{subtitle:'test'}}));
jest.mock('../src/store/auth-context',()=>({useAuth:()=>({})}));
jest.mock('../src/utils/constants',()=>({APP_VERSION:'test'}));
jest.mock('../src/api/client',()=>({resetClient:jest.fn()}));
jest.mock('../src/utils/secure-storage',()=>({clearSession:jest.fn()}));
jest.mock('../src/config/api',()=>({
 getBaseUrl:jest.fn(async()=>mockLanOnly?'http://192.168.1.5:18002':'https://app.alraqi-erp.com/api'),
 getLanOnlySync:jest.fn(async()=>mockLanOnly),
 setLanOnlySync:jest.fn(async(value:boolean)=>{mockLanOnly=value;}),
 pingServer:jest.fn(async()=>({ok:false})),setStoredBaseUrl:jest.fn(),clearStoredBaseUrl:jest.fn(),isValidBaseUrl:()=>true,
}));
import {ServerSettingsModal} from '../src/screens/login';
import {getLanOnlySync,setLanOnlySync,pingServer,setStoredBaseUrl} from '../src/config/api';
import {clearSession} from '../src/utils/secure-storage';
import {Alert} from 'react-native';
const {create,act}=require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const props={visible:true,onClose:jest.fn(),currentUrl:'http://192.168.1.5:18002',storedUrl:null,defaultUrl:'http://192.168.1.5:18002',onSaved:jest.fn()};
describe('network recovery before login',()=>{
 beforeEach(()=>{jest.clearAllMocks();mockLanOnly=true;(getLanOnlySync as any).mockImplementation(async()=>mockLanOnly);(setLanOnlySync as any).mockImplementation(async(value:boolean)=>{mockLanOnly=value;});(pingServer as any).mockResolvedValue({ok:false});});
 it('lets a signed-out device leave LAN-only mode without clearing identity, queue, or configured server',async()=>{
  let tree:any;await act(async()=>{tree=create(<ServerSettingsModal {...props}/>);});
  const control=tree.root.findByType('Switch');expect(control.props.value).toBe(true);expect(control.props.disabled).toBe(false);
  await act(async()=>{await control.props.onValueChange(false);});
  expect(setLanOnlySync).toHaveBeenCalledWith(false);expect(mockLanOnly).toBe(false);
  expect(clearSession).not.toHaveBeenCalled();expect(setStoredBaseUrl).not.toHaveBeenCalled();expect(props.onSaved).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain('https://app.alraqi-erp.com/api');
  await act(async()=>tree.unmount());
 });
 it('ignores a late response from the unreachable old route after switching mode',async()=>{
  let finish!:(value:any)=>void;(pingServer as any).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  let tree:any;await act(async()=>{tree=create(<ServerSettingsModal {...props}/>);});
  await act(async()=>{await tree.root.findByType('Switch').props.onValueChange(false);});
  await act(async()=>{finish({ok:true,latencyMs:999});});
  expect(JSON.stringify(tree.toJSON())).not.toContain('999 ms');
  expect(JSON.stringify(tree.toJSON())).toContain('https://app.alraqi-erp.com/api');
  await act(async()=>tree.unmount());
 });
 it('keeps the previous choice if its encrypted preference cannot be saved',async()=>{
  (setLanOnlySync as any).mockRejectedValueOnce(new Error('storage unavailable'));
  let tree:any;await act(async()=>{tree=create(<ServerSettingsModal {...props}/>);});
  await act(async()=>{await tree.root.findByType('Switch').props.onValueChange(false);});
  expect(tree.root.findByType('Switch').props.value).toBe(true);expect(Alert.alert).toHaveBeenCalled();expect(clearSession).not.toHaveBeenCalled();
  await act(async()=>tree.unmount());
 });
});
