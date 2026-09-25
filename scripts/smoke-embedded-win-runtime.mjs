import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('Run this smoke test on Windows.');
const runtime = path.resolve(process.argv[2] || 'artifacts/embedded-win-runtime/native-runtime');
const bin = path.join(runtime, 'postgres', 'pgsql', 'bin');
const node = path.join(runtime, 'node', 'node.exe');
const backend = path.join(runtime, 'manifest', 'packages', 'backend', 'dist', 'main.js');
const directory = await mkdtemp(path.join(os.tmpdir(), 'manifest-embedded-smoke-'));
const data = path.join(directory, 'postgres-data');
const log = path.join(directory, 'postgres.log');
let server;
let postgresStarted = false;
let backendError;

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

function run(file, args, env, timeout = 120_000, capture = true) {
  const result = spawnSync(file, args, {
    cwd: bin, env, encoding: 'utf8', timeout, windowsHide: true,
    stdio: capture ? 'pipe' : 'ignore',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(file)} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`);
  }
}

try {
  const databasePort = await freePort();
  const backendPort = await freePort();
  const databaseUrl = `postgresql://manifest@127.0.0.1:${databasePort}/manifest`;
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    PGHOST: '127.0.0.1',
    PGPORT: String(databasePort),
    PGUSER: 'manifest',
  };
  run(path.join(bin, 'initdb.exe'), ['-D', data, '-U', 'manifest', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8'], env, 180_000);
  run(path.join(bin, 'pg_ctl.exe'), ['-D', data, '-o', `-h 127.0.0.1 -p ${databasePort}`, '-w', '-t', '45', '-l', log, 'start'], env, 60_000, false);
  postgresStarted = true;
  run(path.join(bin, 'createdb.exe'), ['manifest'], env, 30_000);
  const backendEnv = {
    ...env,
    NODE_ENV: 'production',
    PORT: String(backendPort),
    BIND_ADDRESS: '127.0.0.1',
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'embedded-smoke-secret-at-least-32-characters',
    MANIFEST_ENCRYPTION_KEY: 'embedded-smoke-encryption-key-32-characters',
    BETTER_AUTH_URL: `http://localhost:${backendPort}`,
    MANIFEST_MODE: 'embedded',
    MCP_ENABLED: 'false',
    MANIFEST_TELEMETRY_DISABLED: '1',
    MANIFEST_UPDATE_CHECK_DISABLED: '1',
    AUTOFIX_GLOBAL_ENABLED: 'false',
    SEED_DATA: 'false',
    REQUEST_RECORDING_STORAGE: 'filesystem',
    REQUEST_RECORDING_FILESYSTEM_PATH: path.join(directory, 'recordings'),
  };
  server = spawn(node, [backend], {
    cwd: path.join(runtime, 'manifest'), env: backendEnv, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.on('error', (error) => { backendError = error; });
  server.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16_000); });
  server.stdout.on('data', () => {});
  const deadline = Date.now() + 120_000;
  let healthy = false;
  while (Date.now() < deadline && server.exitCode === null && server.signalCode === null && !backendError) {
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) { healthy = true; break; }
    } catch { /* Wait for database migrations and server startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!healthy) throw new Error(`Embedded backend did not become healthy. ${backendError?.message || stderr}`);
  console.log('Embedded Windows runtime: PostgreSQL and Manifest health check passed.');
} catch (error) {
  console.error('Embedded runtime smoke test failed:', error);
  const postgresLog = await readFile(log, 'utf8').catch(() => '');
  if (postgresLog) console.error(postgresLog.slice(-8_000));
  throw error;
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill();
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
  if (postgresStarted || await access(path.join(data, 'PG_VERSION')).then(() => true, () => false)) {
    try { run(path.join(bin, 'pg_ctl.exe'), ['-D', data, '-m', 'immediate', '-w', '-t', '30', 'stop'], {
      ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
    }, 45_000, false); } catch (error) { console.error(error); }
  }
  try { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); }
  catch (error) { console.error('Could not remove temporary smoke-test data:', error); }
}
