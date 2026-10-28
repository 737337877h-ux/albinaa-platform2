const path = require('path');
const { installProductHook } = require('./native-product.cjs');
installProductHook(path.resolve(__dirname, '..'));
