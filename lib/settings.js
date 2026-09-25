import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function dshHome() {
  return path.resolve(process.env.DSH_HOME || path.join(homedir(), '.dsh'));
}

export function settingsPath() {
  return path.join(dshHome(), 'wsc', 'settings.json');
}

export function readSettings() {
  const filename = settingsPath();
  if (!existsSync(filename)) {
    mkdirSync(path.dirname(filename), { recursive: true });
    const initial = `${JSON.stringify({ implementation: 'v1' }, null, 2)}\n`;
    try {
      writeFileSync(filename, initial, { flag: 'wx' });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filename, 'utf8'));
  } catch (error) {
    throw new Error(`WSC settings file is not valid JSON: ${filename}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`WSC settings must be a JSON object: ${filename}`);
  }
  const keys = Object.keys(parsed);
  if (keys.some((key) => key !== 'implementation')) {
    throw new Error(`Unknown WSC settings key: ${keys.find((key) => key !== 'implementation')}`);
  }
  if (!['v1', 'v2'].includes(parsed.implementation)) {
    throw new Error('WSC settings implementation must be "v1" or "v2"');
  }
  return { implementation: parsed.implementation };
}

export function atomicWrite(filename, contents) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, contents, { flag: 'wx' });
  renameSync(temp, filename);
}
