import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.argv[2] || '.env.prod');
if (!fs.existsSync(file)) {
  console.error(`Missing production environment file: ${file}`);
  process.exit(1);
}

const values = {};
for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator < 1) continue;
  values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
}

const errors = [];
const required = [
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB',
  'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ADMIN_INITIAL_PASSWORD',
  'CORS_ORIGINS', 'NEXT_PUBLIC_API_URL',
];
for (const key of required) {
  if (!values[key]) errors.push(`${key} is required`);
}

for (const [key, value] of Object.entries(values)) {
  if (/CHANGE_ME|yourdomain\.com|example\.com/i.test(value)) errors.push(`${key} still contains a placeholder`);
}

for (const key of ['POSTGRES_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ADMIN_INITIAL_PASSWORD']) {
  if (values[key] && values[key].length < 32) errors.push(`${key} must contain at least 32 characters`);
}
if (values.JWT_ACCESS_SECRET && values.JWT_ACCESS_SECRET === values.JWT_REFRESH_SECRET) {
  errors.push('JWT access and refresh secrets must be different');
}

const assertHttps = (key, input) => {
  if (!input) return;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:') errors.push(`${key} must use HTTPS`);
  } catch {
    errors.push(`${key} contains an invalid URL: ${input}`);
  }
};
for (const origin of (values.CORS_ORIGINS || '').split(',').filter(Boolean)) assertHttps('CORS_ORIGINS', origin.trim());
assertHttps('NEXT_PUBLIC_API_URL', values.NEXT_PUBLIC_API_URL);
if (values.CORS_ORIGINS?.includes('*')) errors.push('CORS_ORIGINS must not contain a wildcard');
if (values.PUSH_ENABLED === 'true' && !values.EXPO_ACCESS_TOKEN) {
  errors.push('EXPO_ACCESS_TOKEN is required when PUSH_ENABLED=true');
}

if (errors.length) {
  console.error(`Production readiness failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Production environment validation passed.');
