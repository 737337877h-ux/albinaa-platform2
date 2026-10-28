import {jest,beforeEach,it,expect} from '@jest/globals';
jest.mock('expo-local-authentication',()=>({hasHardwareAsync:jest.fn(),isEnrolledAsync:jest.fn(),authenticateAsync:jest.fn()}));
import * as auth from 'expo-local-authentication';
import {verifyBiometric} from '../src/utils/biometric-unlock';
beforeEach(()=>{jest.resetAllMocks();jest.mocked(auth.hasHardwareAsync).mockResolvedValue(true);jest.mocked(auth.isEnrolledAsync).mockResolvedValue(true);});
it('does not open without biometrics enabled or enrolled',async()=>{
 expect(await verifyBiometric(false)).toBe(false);expect(auth.authenticateAsync).not.toHaveBeenCalled();
 jest.mocked(auth.isEnrolledAsync).mockResolvedValue(false);expect(await verifyBiometric(true)).toBe(false);
});
it('requires a new successful strong biometric prompt, including after cancellation',async()=>{
 jest.mocked(auth.authenticateAsync).mockResolvedValueOnce({success:false,error:'user_cancel'}).mockResolvedValueOnce({success:true});
 expect(await verifyBiometric(true)).toBe(false);expect(await verifyBiometric(true)).toBe(true);
 expect(auth.authenticateAsync).toHaveBeenCalledTimes(2);
 expect(auth.authenticateAsync).toHaveBeenCalledWith(expect.objectContaining({disableDeviceFallback:true,biometricsSecurityLevel:'strong'}));
});
