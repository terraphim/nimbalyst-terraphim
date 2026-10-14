import path from 'node:path';

// A lexical descendant test; callers must also verify real paths for symlink boundaries.
export function isDescendant(base, candidate, pathApi = path) {
  if (!pathApi.isAbsolute(base) || !pathApi.isAbsolute(candidate)) return false;
  const relative = pathApi.relative(base, candidate);
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative);
}
