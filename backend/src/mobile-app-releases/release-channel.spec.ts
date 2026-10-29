import { releaseChannel } from './release-channel';
import { MobileAppReleasesService } from './mobile-app-releases.service';
import { readBinaryManifest } from './apk-manifest';
describe('independent release channels',()=>{
  it('preserves the existing key and rejects unknown channels',()=>{
    expect(releaseChannel().settingKey).toBe('mobile.app.releases');
    expect(releaseChannel('operations').settingKey).toBe('mobile.operations.releases');
    expect(()=>releaseChannel('other')).toThrow();
  });
  it('never returns a collector release from the Operations feed',async()=>{
    const db:any={systemSetting:{findUnique:jest.fn(async({where}:any)=>where.organizationId_key.key==='mobile.app.releases'?{value:{releases:[{id:'66-test',versionCode:66,status:'published'}]}}:null)}};
    const service=new MobileAppReleasesService(db,{} as any), user:any={organizationId:'org'};
    expect((await service.latest(user))?.packageId).toBe('com.albinaa.collector');
    expect(await service.latest(user,'operations')).toBeNull();
    await expect(service.download(user,'66-test','operations')).rejects.toThrow('غير موجود');
  });
  it('rejects arbitrary files masquerading as Android XML',()=>{
    for(const b of [Buffer.alloc(0),Buffer.from('<manifest package="com.alraqi.operations"/>'),Buffer.alloc(128)])expect(()=>readBinaryManifest(b)).toThrow();
  });
});
