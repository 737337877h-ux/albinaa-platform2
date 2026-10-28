import {NextRequest} from 'next/server';
import {randomBytes} from 'node:crypto';
const paths=new Set(['/inventory/barcodes','/tasks','/hr/tasks','/reports/kpi','/admin/users','/admin/roles','/admin/collectors','/admin/assignments']);
export async function POST(request:NextRequest){
 const raw=await request.text();if(raw.length>12000)return new Response('Too large',{status:413});
 const data=new URLSearchParams(raw),token=data.get('token')??'',path=data.get('path')??'';
 if(!paths.has(path)||!/^[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+\.[-_a-zA-Z0-9]+$/.test(token))return new Response('Invalid session',{status:400});
 const nonce=randomBytes(18).toString('base64');
 const script=`sessionStorage.setItem('albinaa.mobile','1');sessionStorage.setItem('albinaa.at',${JSON.stringify(token)});sessionStorage.removeItem('albinaa.rt');location.replace(${JSON.stringify(path)});`;
 return new Response(`<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><body>جارٍ فتح الشاشة…<script nonce="${nonce}">${script}</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`}});
}
