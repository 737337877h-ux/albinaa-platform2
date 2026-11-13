const path = require('path');
const { installProductHook } = require('./native-product.cjs');
require('./patch-background-scheduler.cjs').patchBackgroundScheduler(path.resolve(__dirname, '..'));
installProductHook(path.resolve(__dirname, '..'));
