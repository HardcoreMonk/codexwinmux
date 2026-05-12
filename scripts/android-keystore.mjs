import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(__dirname);
const androidDir = join(rootDir, 'android');
const keystorePath = join(androidDir, 'release.keystore');
const propertiesPath = join(androidDir, 'keystore.properties');

const hardenSecretFile = (filePath) => {
  if (!existsSync(filePath)) return;
  chmodSync(filePath, 0o600);
};

if (existsSync(keystorePath) || existsSync(propertiesPath)) {
  hardenSecretFile(keystorePath);
  hardenSecretFile(propertiesPath);
  console.log('[android:keystore] Existing release.keystore or keystore.properties found. Nothing changed.');
  process.exit(0);
}

const password = randomBytes(24).toString('base64url');
const alias = 'codexwinmux';

mkdirSync(androidDir, { recursive: true });

const result = spawnSync('keytool', [
  '-genkeypair',
  '-v',
  '-keystore',
  keystorePath,
  '-storepass',
  password,
  '-keypass',
  password,
  '-alias',
  alias,
  '-keyalg',
  'RSA',
  '-keysize',
  '2048',
  '-validity',
  '10000',
  '-dname',
  'CN=codexmux, OU=codexmux, O=HardcoreMonk, L=Seoul, ST=Seoul, C=KR',
], { stdio: 'inherit' });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

writeFileSync(propertiesPath, [
  'storeFile=release.keystore',
  `storePassword=${password}`,
  `keyAlias=${alias}`,
  `keyPassword=${password}`,
  '',
].join('\n'), { mode: 0o600 });
hardenSecretFile(keystorePath);
hardenSecretFile(propertiesPath);

console.log('[android:keystore] Created android/release.keystore and android/keystore.properties.');
