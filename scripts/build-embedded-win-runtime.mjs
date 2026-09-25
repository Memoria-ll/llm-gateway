import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { downloadArchive } from './embedded-runtime-download-cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_REPOSITORY = 'https://github.com/Memoria-ll/llm-gateway';
const MANIFEST_COMMIT = process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD'], { cwd: ROOT, stdio: 'pipe' });
if (!/^[0-9a-f]{40}$/.test(MANIFEST_COMMIT)) throw new Error('Manifest commit SHA is invalid.');
const SOURCES = [
  {
    name: 'Node.js Windows x64',
    url: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',
    file: 'node-v24.21.0-win-x64.zip',
    sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
  },
  {
    name: 'PostgreSQL Windows x64',
    url: 'https://get.enterprisedb.com/postgresql/postgresql-16.15-1-windows-x64-binaries.zip',
    file: 'postgresql-16.15-1-windows-x64-binaries.zip',
    sha256: '25e6fcdfb8caec38691bf461125e7564508760666f7b8e5dc6a5f0818f58f81e',
  },
];

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${file} failed (${result.status ?? result.signal}): ${result.stderr || ''}`);
  }
  return result.stdout?.trim() ?? '';
}

function psLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function expandZip(archive, destination) {
  run('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath ${psLiteral(archive)} -DestinationPath ${psLiteral(destination)} -Force`,
  ]);
}

async function pruneNodeModules(directory) {
  const removeNames = new Set(['__tests__', 'test', 'tests', 'docs', 'examples', '.github']);
  const legalNotice = /^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|PATENTS|AUTHORS|THIRD[-_]PARTY[-_]LICENSES)([._-].*)?$/i;
  async function retainLegalNotices(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await retainLegalNotices(file);
        if ((await readdir(file)).length === 0) await rm(file, { recursive: true, force: true });
      } else if (!legalNotice.test(entry.name)) {
        await rm(file, { force: true });
      }
    }
  }
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (removeNames.has(entry.name)) {
          await retainLegalNotices(file);
          if ((await readdir(file)).length === 0) await rm(file, { recursive: true, force: true });
        } else await visit(file);
      } else if (
        entry.name.endsWith('.map') ||
        entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ||
        /^(README|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT)(\.|$)/i.test(entry.name) ||
        entry.name.endsWith('.mdx')
      ) {
        await rm(file, { force: true });
      }
    }
  }
  await visit(directory);
  for (const relative of [
    'node_modules/typescript',
    'node_modules/@types',
    'node_modules/ts-node',
    'node_modules/acorn',
    'node_modules/create-require',
    'node_modules/v8-compile-cache-lib',
  ]) {
    await rm(path.join(directory, relative), { recursive: true, force: true });
  }
}

async function copyRuntime(source, output, nodeRoot, postgresRoot, temporary) {
  const nodeSource = path.join(nodeRoot, 'node-v24.21.0-win-x64');
  const postgresSource = path.join(postgresRoot, 'pgsql');
  const manifestInstall = path.join(temporary, 'manifest-runtime');
  const manifestOutput = path.join(output, 'manifest');
  const nodeOutput = path.join(output, 'node');
  const postgresOutput = path.join(output, 'postgres', 'pgsql');

  await mkdir(manifestInstall, { recursive: true });
  await mkdir(manifestOutput, { recursive: true });
  await mkdir(nodeOutput, { recursive: true });
  await mkdir(postgresOutput, { recursive: true });

  await cp(path.join(nodeSource, 'node.exe'), path.join(nodeOutput, 'node.exe'));
  await cp(path.join(nodeSource, 'LICENSE'), path.join(nodeOutput, 'LICENSE'));

  for (const folder of ['bin', 'lib', 'share']) {
    await cp(path.join(postgresSource, folder), path.join(postgresOutput, folder), { recursive: true });
  }
  const postgresPythonRuntime = path.join(postgresSource, 'pgAdmin 4', 'python');
  for (const runtimeDll of ['vcruntime140.dll', 'vcruntime140_1.dll']) {
    await cp(path.join(postgresPythonRuntime, runtimeDll), path.join(postgresOutput, 'bin', runtimeDll));
  }
  await mkdir(path.join(output, 'postgres', 'licenses'), { recursive: true });
  for (const license of [
    'server_license.txt',
    'commandlinetools_3rd_party_licenses.txt',
    'pgAdmin_3rd_party_licenses.txt',
    'pgAdmin_license.txt',
  ]) {
    const file = path.join(postgresSource, license);
    if (await access(file).then(() => true, () => false)) {
      await cp(file, path.join(output, 'postgres', 'licenses', license));
    }
  }

  for (const file of ['package.json', 'package-lock.json', 'LICENSE']) {
    await cp(path.join(source, file), path.join(manifestInstall, file));
  }
  for (const workspace of ['shared', 'frontend', 'backend', 'manifest', 'cli']) {
    const sourceWorkspace = path.join(source, 'packages', workspace);
    const targetWorkspace = path.join(manifestInstall, 'packages', workspace);
    await mkdir(targetWorkspace, { recursive: true });
    await cp(path.join(sourceWorkspace, 'package.json'), path.join(targetWorkspace, 'package.json'));
    if (['shared', 'frontend', 'backend'].includes(workspace)) {
      await cp(path.join(sourceWorkspace, 'dist'), path.join(targetWorkspace, 'dist'), { recursive: true });
    }
  }

  const nodeExe = path.join(nodeRoot, 'node-v24.21.0-win-x64', 'node.exe');
  const npmCli = path.join(nodeRoot, 'node-v24.21.0-win-x64', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  run(nodeExe, [npmCli, 'ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: manifestInstall,
  });
  await pruneNodeModules(path.join(manifestInstall, 'node_modules'));
  await cp(manifestInstall, manifestOutput, { recursive: true, dereference: true });
}

// Increment this when the generated runtime layout changes.
const RUNTIME_RECIPE_VERSION = 2;

if (process.platform !== 'win32') {
  throw new Error('Windows向けランタイムの準備はWindows上で実行してください。最終利用者にはNode.js等の事前インストールは不要です。');
}

const temporary = path.join(os.tmpdir(), `manifest-embedded-runtime-${process.pid}`);
const output = path.join(ROOT, 'artifacts', 'embedded-win-runtime', 'native-runtime');
const downloadCache = process.env.MANIFEST_RUNTIME_DOWNLOAD_CACHE;

try {
  await mkdir(temporary, { recursive: true });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const source of SOURCES) await downloadArchive(source, path.join(temporary, source.file), downloadCache);

  const nodeRoot = path.join(temporary, 'node');
  const postgresRoot = path.join(temporary, 'postgres');
  await Promise.all([mkdir(nodeRoot), mkdir(postgresRoot)]);

  expandZip(path.join(temporary, SOURCES[0].file), nodeRoot);
  expandZip(path.join(temporary, SOURCES[1].file), postgresRoot);

  const nodeRootDirectory = path.join(nodeRoot, 'node-v24.21.0-win-x64');
  const nodeExe = path.join(nodeRootDirectory, 'node.exe');
  const npmCli = path.join(nodeRootDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  run(nodeExe, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });

  const backendSource = path.join(ROOT, 'packages', 'backend');
  const turbo = path.join(ROOT, 'node_modules', 'turbo', 'bin', 'turbo');
  run(nodeExe, [
    turbo,
    'build',
    '--filter=manifest-frontend',
    '--filter=manifest-shared',
  ], { cwd: ROOT, stdio: 'inherit' });
  run(nodeExe, ['-e', "require('node:fs').rmSync('tsconfig.build.tsbuildinfo', { force: true })"], { cwd: backendSource });
  run(nodeExe, [path.join(ROOT, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js'), 'build'], {
    cwd: backendSource,
    stdio: 'inherit',
  });

  await copyRuntime(ROOT, output, nodeRoot, postgresRoot, temporary);
  await writeFile(path.join(output, 'runtime-info.json'), JSON.stringify({
    recipeVersion: RUNTIME_RECIPE_VERSION,
    manifestRepository: MANIFEST_REPOSITORY,
    manifestCommit: MANIFEST_COMMIT,
    node: '24.21.0',
    postgresql: '16.15-1',
    packageLockSha256: createHash('sha256').update(await readFile(path.join(ROOT, 'package-lock.json'))).digest('hex'),
    nodeSha256: SOURCES[0].sha256,
    postgresqlSha256: SOURCES[1].sha256,
  }, null, 2) + '\n');
  console.log(`Native Windows runtime prepared at ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
