import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, cp, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function archivePath(source, cacheDirectory) {
  const key = createHash('sha256').update(`${source.url}\n${source.sha256 ?? ''}`).digest('hex');
  return path.join(cacheDirectory, `${key}-${source.file}`);
}

async function matchesChecksum(file, expected) {
  if (!expected) return true;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === expected;
}

async function fetchArchive(source, destination) {
  console.log(`Downloading ${source.name}...`);
  const response = await fetch(source.url, { redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`Could not download ${source.name}: HTTP ${response.status}`);
  const hash = source.sha256 ? createHash('sha256') : undefined;
  const streams = [Readable.fromWeb(response.body)];
  if (hash) streams.push(new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  }));
  streams.push(createWriteStream(destination));
  try {
    await pipeline(...streams);
    const actual = hash?.digest('hex');
    if (actual && actual !== source.sha256) {
      throw new Error(`${source.name} checksum mismatch: expected ${source.sha256}, received ${actual}`);
    }
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

export async function invalidateArchive(source, cacheDirectory) {
  if (cacheDirectory) await rm(archivePath(source, cacheDirectory), { force: true });
}

export async function downloadArchive(source, destination, cacheDirectory) {
  if (!cacheDirectory) return fetchArchive(source, destination);
  await mkdir(cacheDirectory, { recursive: true });
  const cached = archivePath(source, cacheDirectory);
  if (await access(cached).then(() => true, () => false)) {
    if (await matchesChecksum(cached, source.sha256)) {
      console.log(`Using cached ${source.name} archive.`);
      await cp(cached, destination);
      return;
    }
    await rm(cached, { force: true });
  }
  const temporary = path.join(cacheDirectory, `.${randomUUID()}.tmp`);
  try {
    await fetchArchive(source, temporary);
    await rename(temporary, cached);
    await cp(cached, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
