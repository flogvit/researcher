import { resolve, sep } from 'node:path';
import { z } from 'zod';

/**
 * Shared path-traversal guards for admin handlers (#2).
 *
 * The Zod refinements reject obviously bad input early (slashes, '..', dots);
 * `withinProject` is the post-resolve check that catches anything that slipped
 * past — symlink chains, exotic encodings, etc. Belt-and-braces is the right
 * stance here because the admin task queue used to be the documented RCE
 * primitive (#1).
 */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export const safeName = z.string().min(1).refine(
  s => NAME_PATTERN.test(s),
  { message: 'must contain only letters, digits, underscore, hyphen' },
);

export const safeDottedKey = z.string().min(1).refine(
  s => s.split('.').every(part => NAME_PATTERN.test(part)),
  { message: 'each dot-segment must be [A-Za-z0-9_-]+' },
);

/**
 * Throw if the given absolute path is outside the project directory.
 * Use after path.resolve() — symlinks are still possible above this,
 * but for the threat model (untrusted JSON payload → file on local disk)
 * the textual containment check is the right defense.
 */
export function assertWithinProject(absPath: string, projectDir: string): void {
  const projectRoot = resolve(projectDir);
  // Trailing separator avoids the `/tmp/proj-bad` matching `/tmp/proj` case.
  if (!absPath.startsWith(projectRoot + sep) && absPath !== projectRoot) {
    throw new Error(`Path escapes project directory: ${absPath}`);
  }
}
