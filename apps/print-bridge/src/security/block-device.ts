import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { atomicJson } from './deviceRegistry.js';
import { loadConfig } from '../config.js';
function isAdministrator(): boolean {
  if (process.platform !== 'win32') return process.getuid?.() === 0;
  try {
    return (
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
        ],
        { encoding: 'utf8', windowsHide: true },
      ).trim() === 'True'
    );
  } catch {
    return false;
  }
}
if (!isAdministrator()) throw new Error('Run this command as the local administrator.');
const [action, id] = process.argv.slice(2);
if (!['block', 'unblock'].includes(action ?? '') || !id || !/^[0-9a-f-]{36}$/i.test(id))
  throw new Error('Usage: block-device block|unblock <device UUID>');
const file = loadConfig().registryFile + '.blocked';
let ids: string[] = [];
try {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string'))
    throw Error('Invalid block file');
  ids = parsed;
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
atomicJson(file, action === 'block' ? [...new Set([...ids, id])] : ids.filter((x) => x !== id));
// Aucun secret dans la sortie ; ce fichier doit être protégé par les ACL du compte de service.
process.stdout.write('Local device block list updated.\n');
