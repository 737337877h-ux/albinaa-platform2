import {beforeEach,expect,it,jest} from '@jest/globals';
const mockGet=jest.fn<any>(),mockPost=jest.fn<any>(),mockSession=jest.fn<any>();
jest.mock('../src/api/client',()=>({getClientForOwner:async()=>({get:mockGet,post:mockPost})}));
jest.mock('../src/utils/business-session',()=>({assertBusinessSession:(...args:any[])=>mockSession(...args)}));
jest.mock('../src/utils/constants',()=>({generateIdempotencyKey:()=> 'fixed-operation'}));
import {applyPromiseCompletion,previewPromiseCompletion,PromiseCompletionPreview} from '../src/utils/promise-completion';
beforeEach(()=>{jest.clearAllMocks();mockSession.mockResolvedValue({owner:'org:u'});});
const plan=():PromiseCompletionPreview=>({owner:'org:u',operationId:'fixed-operation',planHash:'a'.repeat(64),canApply:true,
 completed:false,willComplete:true,remainingAmount:'0.0000',reason:'verified',overlappingPromises:1,receipts:[]});
it('previews without writing and binds the confirmation to its original account and plan',async()=>{
 mockGet.mockResolvedValue({data:plan()});expect((await previewPromiseCompletion('p')).owner).toBe('org:u');
 expect(mockPost).not.toHaveBeenCalled();mockPost.mockResolvedValue({data:{completed:true}});
 await applyPromiseCompletion('p',plan());expect(mockPost).toHaveBeenCalledWith('/payment-promises/p/complete',
  {expectedPlanHash:'a'.repeat(64)},{headers:{'Idempotency-Key':'fixed-operation'}});
});
it('does not apply an incomplete preview or after switching accounts',async()=>{
 await expect(applyPromiseCompletion('p',{...plan(),canApply:false})).rejects.toThrow('معاينة');
 mockSession.mockRejectedValueOnce({code:'SESSION_CHANGED'});
 await expect(applyPromiseCompletion('p',plan())).rejects.toMatchObject({code:'SESSION_CHANGED'});expect(mockPost).not.toHaveBeenCalled();
});
it('sends administrative closure as a distinct mode using its reviewed plan',async()=>{
 mockPost.mockResolvedValue({data:{closed:true,completed:false}});
 await applyPromiseCompletion('p',{...plan(),mode:'account_settlement'});
 expect(mockPost).toHaveBeenCalledWith('/payment-promises/p/complete',{expectedPlanHash:'a'.repeat(64),mode:'account_settlement'},expect.any(Object));
});
