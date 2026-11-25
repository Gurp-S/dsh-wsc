/**
 * Harness home resolution.
 *
 * The desktop process does not export DSH_HOME, so persistence code that reads
 * the variable directly silently disables itself there. dsh resolves the same
 * directory as `$DSH_HOME` first, then `~/.dsh`; mirroring that rule keeps one
 * store across the CLI, the headless harness and the desktop app.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** @returns {string} absolute harness home. */
export function resolveHome() {
  const home = process.env.DSH_HOME
  return typeof home === 'string' && home !== '' ? home : join(homedir(), '.dsh')
}
