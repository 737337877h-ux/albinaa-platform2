const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findFirst({where:{username:'admin'},include:{userRoles:{include:{role:{include:{rolePermissions:{include:{permission:true}}}}}}}}).then(u => {
  const perms = [...new Set(u.userRoles.flatMap(ur => ur.role.rolePermissions.map(rp => rp.permission.code)))];
  console.log('Has promises.create:', perms.includes('promises.create'));
  console.log('Has collections.create:', perms.includes('collections.create'));
  console.log('All perm count:', perms.length);
  console.log('Sample:', perms.slice(0, 30));
  return p.$disconnect();
}).catch(e => {console.error(e); return p.$disconnect();});
