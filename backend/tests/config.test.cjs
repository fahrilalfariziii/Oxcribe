const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function configModule() {
  const filename = path.join(__dirname, '../src/lib/config.ts');
  if (!fs.existsSync(filename)) return { validateRuntimeConfig: () => [] };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, URL });
  return module.exports;
}

test('production startup rejects incomplete payment configuration', () => {
  assert.throws(() => configModule().validateRuntimeConfig({ NODE_ENV: 'production' }), /DATABASE_URL|JWT_SECRET/);
});

test('production startup rejects weak secrets and insecure public callback origins', () => {
  assert.throws(() => configModule().validateRuntimeConfig({
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@localhost/test',
    JWT_SECRET: 'short', CORS_ORIGIN: 'http://app.example.test',
    PUBLIC_BASE_URL: 'http://app.example.test', DOKU_IS_PRODUCTION: 'false',
  }), /JWT_SECRET|HTTPS|DOKU/);
});

test('valid production configuration is accepted without reading files', () => {
  assert.doesNotThrow(() => configModule().validateRuntimeConfig({
    NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@localhost/test',
    JWT_SECRET: 's'.repeat(48), CORS_ORIGIN: 'https://app.example.test,https://admin.example.test',
    PUBLIC_BASE_URL: 'https://app.example.test', DOKU_NOTIFICATION_URL: 'https://api.example.test/api/public/doku/notification',
    DOKU_IS_PRODUCTION: 'true', DOKU_CLIENT_ID: 'merchant', DOKU_SECRET_KEY: 'secret',
    DOKU_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nexample\\n-----END PRIVATE KEY-----',
    DOKU_MERCHANT_ID: 'merchant-id', DOKU_TERMINAL_ID: 'terminal-id',
  }));
});
