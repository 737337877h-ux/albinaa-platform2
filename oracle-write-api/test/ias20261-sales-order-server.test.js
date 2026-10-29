'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createSalesOrderHandler}=require('../src/ias20261-sales-order-server');
for(const [name,error,status] of [
  ['unknown commit result',new Error('NJS-500: connection lost'),503],
  ['validation',Object.assign(new Error('Invalid quantity'),{name:'SalesOrderValidationError'}),400],
  ['lock busy',Object.assign(new Error('busy'),{errorNum:54}),409],
  ['reference changed',new Error('Sales-order reference conflict'),409],
])test(name,async()=>{
  let calls=0;
  const server=http.createServer(createSalesOrderHandler({apiKey:'test'},{createDraft:async()=>{calls++;throw error;}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url=`http://127.0.0.1:${server.address().port}/sales/customer-orders`;
    assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
    assert.equal(calls,0);
    assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer test'},body:'{}'})).status,status);
    assert.equal(calls,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
