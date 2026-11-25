// Node >=22. Caller-owned local secrets only; never use a shared/server directory.
import { constants } from 'node:fs';
import { mkdir, lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** @returns {never} */
const fail = () => { const error = new Error('CREDENTIAL_STORE_UNAVAILABLE'); error.code = 'CREDENTIAL_STORE_UNAVAILABLE'; throw error; };
const token = value => typeof value === 'string' && /^[\x21-\x7e]{1,18000}$/.test(value) && !/[\s,]/.test(value);
export function validateStoredTokens(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['clientId', 'accessToken', 'refreshToken', 'expiresAt'].includes(key))
    || typeof value.clientId !== 'string' || !/^[A-Za-z0-9._~-]{1,512}$/.test(value.clientId)
    || !token(value.accessToken) || !token(value.refreshToken)
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) fail();
  return { clientId: value.clientId, accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt };
}

/** POSIX local single-process store. Windows/remote hosts should provide their own
 * secret-store callbacks. No I/O occurs until load/save is called. Never trace it.
 */
export function createCredentialFileStore(filename) {
  if (typeof filename !== 'string' || !filename.trim() || /[\u0000-\u001f]/.test(filename)
    || typeof process.getuid !== 'function') fail();
  const file = resolve(filename);
  const directory = dirname(file);
  const uid = process.getuid();
  async function directoryReady(create = false) {
    if (create) {
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (error) { if (error?.code !== 'EEXIST') fail(); }
    }
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid
      || (stat.mode & 0o077) !== 0 || await realpath(directory) !== directory) fail();
  }
  async function existing() {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid
        || (stat.mode & 0o077) !== 0 || stat.nlink !== 1 || stat.size > 65536) fail();
      return true;
    } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  }
  async function loadTokens() {
    let handle;
    try {
      await directoryReady();
      if (!await existing()) fail();
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || stat.nlink !== 1 || stat.size > 65536) fail();
      return validateStoredTokens(JSON.parse(await handle.readFile('utf8')));
    } catch { fail(); }
    finally { await handle?.close().catch(() => {}); }
  }
  async function saveTokens(value, { createOnly = false } = {}) {
    let handle;
    let temporary;
    let createdIdentity;
    try {
      const checked = validateStoredTokens(value);
      await directoryReady(true);
      const exists = await existing();
      if (createOnly && exists) fail();
      const payload = `${JSON.stringify(checked)}\n`;
      if (createOnly) {
        handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        createdIdentity = await handle.stat();
        await handle.writeFile(payload); await handle.sync(); await handle.close(); handle = undefined;
        createdIdentity = undefined;
      } else {
        if (!exists) fail();
        const prior = await loadTokens();
        if (prior.clientId !== checked.clientId) fail();
        temporary = join(directory, `.${basename(file)}.${randomUUID()}.tmp`);
        handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await handle.writeFile(payload); await handle.sync(); await handle.close(); handle = undefined;
        if (!await existing()) fail();
        await rename(temporary, file); temporary = undefined;
      }
    } catch {
      await handle?.close().catch(() => {}); handle = undefined;
      if (createdIdentity) {
        try { const current = await lstat(file); if (current.dev === createdIdentity.dev && current.ino === createdIdentity.ino) await unlink(file); }
        catch { /* Never remove a different or pre-existing destination. */ }
      }
      fail();
    }
    finally { await handle?.close().catch(() => {}); if (temporary) await unlink(temporary).catch(() => {}); }
  }
  async function assertCreateReady() {
    try { await directoryReady(true); if (await existing()) fail(); }
    catch { fail(); }
  }
  return Object.freeze({ loadTokens, saveTokens, assertCreateReady });
}
