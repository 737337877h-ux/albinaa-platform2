import { getClientForOwner } from '../api/client';
import { assertBusinessSession } from './business-session';
import { generateIdempotencyKey } from './constants';

export interface PromiseCompletionPreview {
  owner:string;operationId:string;planHash:string;canApply:boolean;completed:boolean;willComplete:boolean;
  remainingAmount:string;reason:string;overlappingPromises:number;
  receipts:{reference:string;date:string;amount:string;currencyCode:string}[];
}
export async function previewPromiseCompletion(id:string):Promise<PromiseCompletionPreview>{
  const {owner}=await assertBusinessSession();
  const {data}=await(await getClientForOwner(owner)).get(`/payment-promises/${id}/completion-preview`);
  await assertBusinessSession(owner);
  return {...data,owner,operationId:generateIdempotencyKey()};
}
export async function applyPromiseCompletion(id:string,preview:PromiseCompletionPreview){
  await assertBusinessSession(preview.owner);
  if(!preview.canApply||!/^[a-f0-9]{64}$/.test(preview.planHash))throw new Error('أعد معاينة السندات قبل التأكيد');
  const {data}=await(await getClientForOwner(preview.owner)).post(`/payment-promises/${id}/complete`,
    {expectedPlanHash:preview.planHash},{headers:{'Idempotency-Key':preview.operationId}});
  await assertBusinessSession(preview.owner);
  return data;
}
