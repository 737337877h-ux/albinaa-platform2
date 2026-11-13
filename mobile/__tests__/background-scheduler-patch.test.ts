import fs from 'fs';
import path from 'path';
import {expect,it} from '@jest/globals';

const {patchSource}=require('../scripts/patch-background-scheduler.cjs');
const source=fs.readFileSync(path.join(__dirname,'../node_modules/expo-background-task/android/src/main/java/expo/modules/backgroundtask/BackgroundTaskScheduler.kt'),'utf8');
it('accepts an already patched source after reinstall/build and rejects unreviewed source changes',()=>{
 expect(patchSource(source)).toBe(source);
 expect(()=>patchSource(source.replace('NetworkType.NOT_REQUIRED','NetworkType.CONNECTED'))).toThrow('Unrecognized');
 expect(()=>patchSource(source+'\n// upstream drift')).toThrow('Unrecognized');
});
