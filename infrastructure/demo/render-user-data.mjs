import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const directory = dirname(fileURLToPath(import.meta.url));
const [metadataPath, outputPath] = process.argv.slice(2);
if (!metadataPath || !outputPath) throw new Error('Provide release JSON and output path.');
const release = JSON.parse(readFileSync(metadataPath, 'utf8'));
if (
  !/^806079021406\.dkr\.ecr\.us-east-2\.amazonaws\.com\//.test(release.apiImage) ||
  !/^806079021406\.dkr\.ecr\.us-east-2\.amazonaws\.com\//.test(release.webImage) ||
  !/^\d+\.\d+\.\d+\.\d+$/.test(release.host) ||
  !/^[a-zA-Z0-9._-]+$/.test(release.tag) ||
  !/^[a-f0-9]{64}$/.test(release.composeSha256) ||
  !release.composeDownloadUrl.startsWith('https://github.com/docker/compose/releases/download/')
) {
  throw new Error('Unexpected deployment destination or release metadata.');
}
const files = {};
for (const name of ['compose.yaml', 'Caddyfile', 'nginx.conf', 'registry.py', 'bootstrap.sh']) {
  files[name] = readFileSync(join(directory, name), 'utf8');
}
files['.env'] = [
  'RELAY_HOST=' + release.host,
  'RELAY_API_IMAGE=' + release.apiImage,
  'RELAY_WEB_IMAGE=' + release.webImage,
  'RELAY_IMAGE_TAG=' + release.tag,
  '',
].join('\n');
const variables = [
  'export RELAY_HOST=' + release.host,
  'export COMPOSE_DOWNLOAD_URL=' + release.composeDownloadUrl,
  'export COMPOSE_SHA256=' + release.composeSha256,
].join('\n');
files['bootstrap.sh'] = files['bootstrap.sh'].replace(
  'cd /opt/relay',
  'cd /opt/relay\n' + variables,
);
const archive = gzipSync(Buffer.from(JSON.stringify(files))).toString('base64');
const script = [
  '#!/bin/bash',
  'set -euo pipefail',
  'umask 077',
  'install -d -m 0700 /opt/relay',
  "python3 - <<'RELAY_FILES'",
  'import base64,gzip,json,pathlib',
  "files=json.loads(gzip.decompress(base64.b64decode('" + archive + "')))",
  "root=pathlib.Path('/opt/relay')",
  'for name,content in files.items():',
  '    target=root/name',
  "    target.write_text(content,encoding='utf-8')",
  '    target.chmod(0o600)',
  'RELAY_FILES',
  'exec bash /opt/relay/bootstrap.sh',
  '',
].join('\n');
if (Buffer.byteLength(script) > 16384) throw new Error('User data exceeds EC2 limit.');
// Boto3 RunInstances encodes UserData automatically; provide the raw script.
writeFileSync(outputPath, script, { mode: 0o600 });
console.log(
  JSON.stringify({ userDataBytes: Buffer.byteLength(script), files: Object.keys(files) }),
);
