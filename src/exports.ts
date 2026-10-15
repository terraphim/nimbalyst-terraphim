/** Save-bound exports. Rust owns document semantics; the host owns filesystem writes. */
import type { ParentController, ControllerHost, SaveReceipt } from './controller.ts';
import { readSource, sha256Utf8, sourceBytes, sourceIdentity, SourceError, type SourceReadOptions } from './source.ts';

export type ExportKind = 'clean' | 'knowledgeGraph';
export type ExportErrorCode = 'invalid_name' | 'source_alias' | 'unsupported' | 'busy' | 'closed' |
 'stale' | 'timeout' | 'invalid_output' | 'destination_exists' | 'write_failed' | 'readback_failed';
export class ExportError extends Error {
 constructor(readonly code: ExportErrorCode, readonly destination?: string, readonly mayExist = false) {
  super(`Export ${code}`); this.name = 'ExportError';
 }
}
export interface DerivedExports { sourceHash: string; clean: string; knowledgeGraph: string }
export interface ExportReceipt {
 kind: ExportKind; destination: string; sha256: string; bytes: number;
 resource: string; session: string; revision: number; sourceHash: string;
 verification: 'host-utf8-text-snapshot';
}
/** These are the existing released Rust exports, on a dedicated WASM instance. */
export interface RustExportEngine {
 open_document(source: string): unknown;
 export_document(): string;
 export_knowledge_graph(): string;
}
export class RustExportDeriver {
 constructor(private readonly engine: RustExportEngine) {}
 /** The caller must supply an export-only WASM instance, never the visual editor's globals. */
 async derive(source: string): Promise<DerivedExports> {
  sourceBytes(source);
  // Extract both outputs synchronously before yielding: another request cannot interleave engine state.
  this.engine.open_document(source);
  const clean = this.engine.export_document(), knowledgeGraph = this.engine.export_knowledge_graph();
  return {sourceHash: await sha256Utf8(source), clean, knowledgeGraph};
 }
}

/** A single conservative basename works on all three supported filesystems. */
export function siblingDestination(resource: string, basename: string): string {
 if (typeof basename !== 'string' || !basename || basename !== basename.trim() ||
     basename === '.' || basename === '..' || /[\x00-\x1f\x7f<>:"/\\|?*]/u.test(basename) ||
     /[. ]$/u.test(basename) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[. ]|$)/iu.test(basename) ||
     new TextEncoder().encode(basename).byteLength > 240 ||
     new TextDecoder().decode(new TextEncoder().encode(basename)) !== basename) throw new ExportError('invalid_name');
 const lastSeparator = Math.max(resource.lastIndexOf('/'), resource.lastIndexOf('\\'));
 if (lastSeparator < 0) throw new ExportError('unsupported');
 if (basename.toLowerCase() === resource.slice(lastSeparator + 1).toLowerCase()) throw new ExportError('source_alias');
 return resource.slice(0, lastSeparator + 1) + basename;
}

const OUTPUT_BYTES_LIMIT = 4 * 1024 * 1024;
function outputBytes(text: string): Uint8Array<ArrayBuffer> {
 if (typeof text !== 'string') throw new ExportError('invalid_output');
 const bytes = new TextEncoder().encode(text);
 if (bytes.byteLength > OUTPUT_BYTES_LIMIT || new TextDecoder('utf-8', {fatal: true}).decode(bytes) !== text)
  throw new ExportError('invalid_output');
 return bytes;
}
function parsedGraph(text: string): void {
 let graph: unknown;
 try {graph = JSON.parse(text);} catch {throw new ExportError('invalid_output');}
 if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new ExportError('invalid_output');
 const value = graph as Record<string, unknown>;
 if (typeof value.name !== 'string' || !value.data || typeof value.data !== 'object' || Array.isArray(value.data))
  throw new ExportError('invalid_output');
 for (const entry of Object.values(value.data)) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ExportError('invalid_output');
  const term = entry as Record<string, unknown>;
  if (!Number.isSafeInteger(term.id) || (term.id as number) < 0 || typeof term.nterm !== 'string' ||
      typeof term.display_value !== 'string' || typeof term.pinned !== 'boolean') throw new ExportError('invalid_output');
 }
}
export interface ExportOptions {
 controller: ParentController; host: ControllerHost; supports: SourceReadOptions['supports']; isCurrent: () => boolean;
 derive: (source: string) => Promise<DerivedExports>; timeoutMs?: number;
}
interface Operation { destination: string; timedOut: boolean; started: boolean; reject: (error: unknown) => void }

/** No overwrite, rollback or automatic retry. A failed/uncertain created file remains visible. */
export class ExportCoordinator {
 private closed = false;
 private operation: Operation | null = null;
 private readonly identity: {workspace: string; resource: string};
 constructor(private readonly options: ExportOptions) {
  if (!Number.isFinite(options.timeoutMs ?? 30000) || (options.timeoutMs ?? 30000) <= 0 ||
      typeof options.host.fs?.read !== 'function' || typeof options.host.fs?.write !== 'function')
   throw new ExportError('unsupported');
  this.identity = sourceIdentity(options.host, {supports: options.supports, isCurrent: options.isCurrent});
 }
 private guard(operation?: Operation): void {
  if (this.closed) throw new ExportError('closed', operation?.destination, operation?.started);
  if (operation?.timedOut) throw new ExportError('timeout', operation.destination, operation.started);
  let identity;
  try {identity = sourceIdentity(this.options.host, {supports: this.options.supports, isCurrent: this.options.isCurrent});}
  catch (error) {
   throw new ExportError(error instanceof SourceError && error.code === 'stale' ? 'stale' : 'unsupported',
    operation?.destination, operation?.started);
  }
  if (identity.workspace !== this.identity.workspace || identity.resource !== this.identity.resource)
   throw new ExportError('stale', operation?.destination, operation?.started);
 }
 private current(receipt: SaveReceipt, operation: Operation): void {
  this.guard(operation);
  const snapshot = this.options.controller.snapshot(), state = this.options.controller.state();
  if (state.dirty || state.error !== null || state.mode !== 'saved' || snapshot.resource !== receipt.resource ||
      snapshot.session !== receipt.session || snapshot.revision !== receipt.revision ||
      snapshot.sourceHash !== receipt.sourceHash || snapshot.source !== receipt.source) throw new ExportError('stale', operation.destination);
 }
 export(kind: ExportKind, basename: string): Promise<ExportReceipt> {
  let destination: string;
  try {
   this.guard();
   if (kind !== 'clean' && kind !== 'knowledgeGraph') throw new ExportError('unsupported');
   if (this.operation) throw new ExportError('busy');
   destination = siblingDestination(this.identity.resource, basename);
  } catch (error) {return Promise.reject(error);}
  let resolve!: (receipt: ExportReceipt) => void, reject!: (error: unknown) => void;
  const result = new Promise<ExportReceipt>((yes, no) => {resolve = yes; reject = no;});
  const operation: Operation = {destination, timedOut: false, started: false, reject};
  this.operation = operation;
  const timer = setTimeout(() => {
   operation.timedOut = true;
   reject(new ExportError('timeout', destination, operation.started));
  }, this.options.timeoutMs ?? 30000);
  void this.run(kind, operation).then(resolve, reject).finally(() => {
   clearTimeout(timer);
   if (this.operation === operation) this.operation = null;
  });
  return result;
 }
 private async run(kind: ExportKind, operation: Operation): Promise<ExportReceipt> {
  const {controller, host} = this.options, {destination} = operation;
  const saved = await controller.save(); this.current(saved, operation);
  const derived = await this.options.derive(saved.source); this.current(saved, operation);
  if (derived.sourceHash !== saved.sourceHash || await sha256Utf8(saved.source) !== saved.sourceHash)
   throw new ExportError('invalid_output', destination);
  const content = kind === 'clean' ? derived.clean : derived.knowledgeGraph;
  const bytes = outputBytes(content); if (kind === 'knowledgeGraph') parsedGraph(content);
  const sha256 = await sha256Utf8(content); this.current(saved, operation);
  let before;
  try {before = await host.fs!.read([destination]);} catch {throw new ExportError('readback_failed', destination);}
  this.current(saved, operation);
  if (!Array.isArray(before) || before.length !== 1 || before[0]?.path !== destination) throw new ExportError('readback_failed', destination);
  if (before[0].exists || before[0].content !== null || before[0].sha256 !== null) throw new ExportError('destination_exists', destination);
  // Re-read the source after derivation and the destination check, immediately before the one write.
  const actual = await readSource(host, {supports: this.options.supports, isCurrent: this.options.isCurrent});
  this.current(saved, operation);
  if (actual.source !== saved.source || actual.sha256 !== saved.sourceHash) throw new ExportError('stale', destination);
  operation.started = true;
  try {
   await host.fs!.write({label: kind === 'clean' ? 'Export clean Markdown' : 'Export knowledge graph', actor: 'user',
    changes: [{path: destination, expectedSha256: null, content}]});
  } catch {throw new ExportError('write_failed', destination, true);}
  // Later edits may proceed: this export remains explicitly bound to the saved snapshot at write start.
  this.guard(operation);
  let after;
  try {after = await host.fs!.read([destination]);} catch {throw new ExportError('readback_failed', destination, true);}
  this.guard(operation);
  if (!Array.isArray(after) || after.length !== 1 || after[0]?.path !== destination || !after[0].exists ||
      after[0].content !== content || after[0].sha256 !== sha256 || await sha256Utf8(after[0].content) !== sha256)
   throw new ExportError('readback_failed', destination, true);
  this.guard(operation);
  if (kind === 'knowledgeGraph') parsedGraph(after[0].content);
  return {kind, destination, sha256, bytes: bytes.byteLength, resource: saved.resource, session: saved.session,
   revision: saved.revision, sourceHash: saved.sourceHash, verification: 'host-utf8-text-snapshot'};
 }
 dispose(): void {
  if (this.closed) return; this.closed = true;
  const operation = this.operation;
  if (operation) operation.reject(new ExportError('closed', operation.destination, operation.started));
 }
}
