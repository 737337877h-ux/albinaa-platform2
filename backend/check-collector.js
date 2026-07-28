const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.collector.findFirst({ include: { user: { select: { username: true } } } }).then(c => {
  console.log('Collector:', JSON.stringify(c, null, 2));
  return p.$disconnect();
}).catch(e => { console.error(e); return p.$disconnect(); });
