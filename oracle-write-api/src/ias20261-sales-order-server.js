'use strict';
const {timingSafeEqual}=require('node:crypto');
function createSalesOrderHandler(config,writer){
  return async(request,response)=>{
    const send=(status,body)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(body));};
    const actual=Buffer.from(request.headers.authorization||''),expected=Buffer.from(`Bearer ${config.apiKey}`);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return send(401,{message:'Unauthorized'});
    const path=new URL(request.url,'http://localhost').pathname;
    if(request.method!=='POST'||!['/sales/customer-orders','/sales/customer-orders/dry-run'].includes(path))return send(404,{message:'Not found'});
    try{
      const chunks=[];let size=0;
      for await(const chunk of request){size+=chunk.length;if(size>65536)return send(413,{message:'Request too large'});chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{message:'Invalid JSON'});}
      return send(200,await (path.endsWith('/dry-run')?writer.dryRun(input):writer.createDraft(input)));
    }catch(error){
      if(error.errorNum===54||error.message==='Sales-order reference conflict')return send(409,{message:'أعد المحاولة بنفس بيانات الطلب؛ مرجع الطلب أو الترقيم مشغول'});
      if(error.errorNum)return send(503,{message:'تعذر تأكيد نتيجة Oracle؛ أعد المحاولة بنفس الطلب',oracleError:error.errorNum});
      if(error.name==='SalesOrderValidationError')return send(400,{message:error.message});
      return send(503,{message:'تعذر تأكيد نتيجة الحفظ؛ أعد المحاولة بنفس الطلب'});
    }
  };
}
module.exports={createSalesOrderHandler};
