// Generate/validate against a disposable schema without loading project .env files.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const command = process.argv[2] || 'generate';
if (!['generate', 'validate'].includes(command)) throw new Error('Only generate and validate are supported');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'oxcribe-prisma-'));
const slash = value => value.replace(/\\/g, '/');
const output = slash(path.resolve(path.dirname(require.resolve('@prisma/client/package.json')), '../../.prisma/client'));
const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8')
  .replace(/generator client \{[\s\S]*?\}/, `generator client {\n provider = "prisma-client-js"\n output = "${output}"\n}`);
const modules = path.resolve(path.dirname(require.resolve('@prisma/client/package.json')), '../..');
fs.symlinkSync(modules, path.join(staging, 'node_modules'), 'junction');
fs.writeFileSync(path.join(staging, 'schema.prisma'), schema);
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), command, '--schema', path.join(staging, 'schema.prisma')], {
  cwd: staging,
  env: { ...process.env, DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused', PRISMA_GENERATE_SKIP_AUTOINSTALL: '1' },
  stdio: 'inherit',
});
for (const file of fs.readdirSync(staging)) {
  const target = path.join(staging, file);
  if (file === 'node_modules' && process.platform === 'win32') fs.rmdirSync(target);
  else if (file === 'node_modules') fs.unlinkSync(target);
  else fs.unlinkSync(target);
}
try { fs.rmdirSync(staging); } catch (error) {
  if (error.code !== 'EBUSY') throw error;
}
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
