/** Newly reconstructed source admission and exact UTF-8 hashing.
 * Reuses published SDK types; the original module was not recovered.
 */
export async function sha256Utf8(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

import type { EditorHost, ProjectFileSnapshot } from '@nimbalyst/extension-sdk/types/editor';
import type { editorHostSupports } from '@nimbalyst/extension-sdk';

export const SOURCE_BYTES_LIMIT = 1024 * 1024;
export type SourceHost = Pick<EditorHost, 'filePath' | 'workspaceId' | 'readOnly' | 'embedded' | 'collaboration'
  | 'capabilities' | 'fs' | 'loadBinaryContent' | 'saveContent' | 'onFileChanged' | 'isDiffModeActive'>;
export interface SourceIdentity { readonly workspace: string; readonly resource: string }
export interface SourceSnapshot {
  readonly identity: SourceIdentity;
  readonly source: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly verification: 'active-resource-raw-utf8';
}
export type SourceErrorCode = 'unsupported' | 'stale' | 'missing' | 'read_failed' | 'invalid_utf8' | 'bom' | 'too_large' | 'inconsistent_read';
export class SourceError extends Error {
  readonly code: SourceErrorCode;
  constructor(code: SourceErrorCode) { super(`Source ${code}`); this.name = 'SourceError'; this.code = code; }
}
export interface SourceReadOptions {
  /** Pass the actual SDK editorHostSupports helper; do not invent host capabilities. */
  supports: typeof editorHostSupports;
  /** Captures controller epoch/disposal. Called before and after every asynchronous operation. */
  isCurrent: () => boolean;
}
const validIdentityPart = (s: unknown): s is string => typeof s === 'string' && s.length > 0
  && !s.includes('\0') && new TextEncoder().encode(s).length <= 4096
  && new TextDecoder().decode(new TextEncoder().encode(s)) === s;

/** Validate UTF-8 without normalization, BOM stripping or silent replacement. */
export function sourceBytes(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string') throw new SourceError('invalid_utf8');
  if (text.length > SOURCE_BYTES_LIMIT) throw new SourceError('too_large');
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > SOURCE_BYTES_LIMIT) throw new SourceError('too_large');
  if (text.startsWith('\uFEFF')) throw new SourceError('bom');
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== text) throw new SourceError('invalid_utf8');
  return bytes;
}
/** Admit only an actual local workspace resource. The real host filesystem owns containment/symlink checks. */
export function sourceIdentity(host: SourceHost, options: SourceReadOptions): SourceIdentity {
  if (!options.isCurrent()) throw new SourceError('stale');
  const resource = host.filePath, workspace = host.workspaceId;
  if (!validIdentityPart(resource) || !validIdentityPart(workspace)
    || !(resource.startsWith('/') || /^[A-Za-z]:[\\/]/.test(resource))
    || !resource.endsWith('.terraphim.md') || /(^|[\\/])\.{1,2}([\\/]|$)/.test(resource)
    || host.readOnly || host.embedded || host.collaboration || host.isDiffModeActive?.()
    || typeof host.fs?.read !== 'function' || typeof host.loadBinaryContent !== 'function'
    || typeof host.saveContent !== 'function' || typeof host.onFileChanged !== 'function') throw new SourceError('unsupported');
  for (const capability of ['binaryContent', 'localFileSave', 'fileChangeNotifications', 'projectFileSystem', 'workspace'] as const) {
    if (!options.supports(host, capability)) throw new SourceError('unsupported');
  }
  return Object.freeze({ workspace, resource });
}

/** Independently compare the host text snapshot and actual active-file bytes, with a second text read. */
export async function readSource(host: SourceHost, options: SourceReadOptions): Promise<SourceSnapshot> {
  const identity = sourceIdentity(host, options);
  const guard = () => {
    if (!options.isCurrent() || host.filePath !== identity.resource || host.workspaceId !== identity.workspace) throw new SourceError('stale');
    sourceIdentity(host, options);
  };
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    guard(); let result: T;
    try { result = await operation(); } catch (error) { guard(); if (error instanceof SourceError) throw error; throw new SourceError('read_failed'); }
    guard(); return result;
  };
  const textRead = async (): Promise<ProjectFileSnapshot> => {
    const rows = await read(() => host.fs!.read([identity.resource]));
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.path !== identity.resource) throw new SourceError('inconsistent_read');
    const row = rows[0];
    if (!row.exists) throw new SourceError('missing');
    if (typeof row.content !== 'string' || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new SourceError('inconsistent_read');
    return row;
  };
  const before = await textRead();
  const raw = await read(() => host.loadBinaryContent());
  if (!(raw instanceof ArrayBuffer)) throw new SourceError('read_failed');
  if (raw.byteLength > SOURCE_BYTES_LIMIT) throw new SourceError('too_large');
  const bytes = new Uint8Array(raw);
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) throw new SourceError('bom');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new SourceError('invalid_utf8'); }
  sourceBytes(source);
  const hash = await read(() => crypto.subtle.digest('SHA-256', raw));
  const sha256 = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  const after = await textRead();
  if (before.content !== source || after.content !== source || before.sha256 !== sha256 || after.sha256 !== sha256) throw new SourceError('inconsistent_read');
  guard();
  return Object.freeze({ identity, source, sha256, bytes: bytes.length, verification: 'active-resource-raw-utf8' });
}
