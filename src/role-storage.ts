import { sha256Utf8 } from './source.ts';

/** The exact released TeRoleGraphStorage implementation, loaded by the verified importer. */
export interface StorageConstructor {
  new(options: { enabled: boolean; namespace: string; indexedDB: IDBFactory }): {
    save(snapshot: string): Promise<unknown>;
    load(): Promise<string | null>;
    close(): void;
  };
}
type SnapshotStorage = InstanceType<StorageConstructor>;
export interface RoleIdentity { workspace: string; role: string; session: string }
export interface RoleCandidate {
  status: 'candidate';
  validation: 'requires-engine-import';
  identity: RoleIdentity;
  namespace: string;
  checkpointId: string;
  sha256: string;
  bytes: number;
  updatedAt: string;
}
export interface UnavailableRoleCheckpoint {
  status: 'unavailable';
  identity: RoleIdentity;
  reason: 'incomplete' | 'invalid_record' | 'missing_or_corrupt_snapshot';
}
export type RoleEntry = RoleCandidate | UnavailableRoleCheckpoint;
export type RoleStorageErrorCode = 'disabled' | 'invalid_input' | 'storage_unavailable' | 'writer_conflict'
  | 'new_session_required' | 'explicit_choice_required' | 'identity_mismatch' | 'stale_selection' | 'import_refused';
export class RoleStorageError extends Error {
  readonly code: RoleStorageErrorCode;
  readonly roleImported: boolean;
  constructor(code: RoleStorageErrorCode, roleImported = false) {
    super(`Role checkpoint ${code}${roleImported ? '; role was imported, but checkpoint persistence failed' : ''}`);
    this.name = 'RoleStorageError'; this.code = code; this.roleImported = roleImported;
  }
}
interface IndexRow {
  schema: 1;
  extensionId: string;
  identity: RoleIdentity;
  namespace: string;
  checkpointId: string;
  owner: string;
  sha256: string;
  bytes: number;
  updatedAt: string;
  state: 'pending' | 'ready';
}
const limit = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && encoder.encode(value).byteLength <= 4096 && !value.includes('\0') && new TextDecoder().decode(encoder.encode(value)) === value;
function identity(value: RoleIdentity): RoleIdentity {
  if (!value || !identifier(value.workspace) || !identifier(value.role) || !identifier(value.session)) throw new RoleStorageError('invalid_input');
  return Object.freeze({ workspace: value.workspace, role: value.role, session: value.session });
}
function snapshotValid(text: unknown): text is string {
  return typeof text === 'string' && encoder.encode(text).byteLength <= limit && new TextDecoder().decode(encoder.encode(text)) === text;
}
/** Bind only the existing snapshot's role names; Rust remains the semantic validator. */
export function assertSnapshotRole(snapshot: string, expectedName: string): void {
  if (!snapshotValid(snapshot) || !identifier(expectedName)) throw new RoleStorageError('invalid_input');
  let envelope: unknown;
  try { envelope = JSON.parse(snapshot); } catch { throw new RoleStorageError('invalid_input'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || typeof (envelope as { graphJson?: unknown }).graphJson !== 'string') throw new RoleStorageError('invalid_input');
  let graph: unknown;
  try { graph = JSON.parse((envelope as { graphJson: string }).graphJson); } catch { throw new RoleStorageError('invalid_input'); }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new RoleStorageError('invalid_input');
  const names = graph as { role?: unknown; thesaurus?: { name?: unknown } };
  if (names.role !== expectedName || names.thesaurus?.name !== expectedName) throw new RoleStorageError('identity_mismatch');
}
function sameIdentity(a: RoleIdentity, b: RoleIdentity): boolean { return a.workspace === b.workspace && a.role === b.role && a.session === b.session; }
function validRow(value: unknown, expected: RoleIdentity, extensionId: string): value is IndexRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as IndexRow;
  return Object.keys(row).sort().join(',') === 'bytes,checkpointId,extensionId,identity,namespace,owner,schema,sha256,state,updatedAt' && row.schema === 1 && row.extensionId === extensionId
    && !!row.identity && sameIdentity(row.identity, expected) && typeof row.namespace === 'string'
    && identifier(row.owner) && identifier(row.checkpointId) && /^[a-f0-9]{64}$/.test(row.sha256)
    && Number.isInteger(row.bytes) && row.bytes >= 0 && row.bytes <= limit
    && typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)) && ['pending', 'ready'].includes(row.state);
}
/** Hash the full unambiguous tuple; never share writer namespaces across windows. */
export async function roleNamespace(extensionId: string, input: RoleIdentity): Promise<string> {
  const checked = identity(input);
  if (!identifier(extensionId)) throw new RoleStorageError('invalid_input');
  return 'nimbalyst-role:v1:' + await sha256Utf8(JSON.stringify([extensionId, checked.workspace, checked.role, checked.session]));
}
function candidate(row: IndexRow): RoleCandidate {
  return { status: 'candidate', validation: 'requires-engine-import', identity: { ...row.identity }, namespace: row.namespace,
    checkpointId: row.checkpointId, sha256: row.sha256, bytes: row.bytes, updatedAt: row.updatedAt };
}

/** Parent-only discovery metadata plus unchanged released per-session snapshot storage. */
export class RoleCheckpoints {
  readonly databaseName: string;
  readonly extensionId: string;
  private readonly Storage: StorageConstructor;
  private readonly indexedDB: IDBFactory;
  private readonly owner = crypto.randomUUID();
  private enabled: boolean;
  private closed = false;
  private epoch = 0;
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private transactions = new Set<IDBTransaction>();
  private storages = new Set<SnapshotStorage>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(options: { Storage: StorageConstructor; indexedDB: IDBFactory; enabled?: boolean; databaseName?: string; extensionId?: string }) {
    this.Storage = options.Storage; this.indexedDB = options.indexedDB; this.enabled = options.enabled === true;
    this.extensionId = options.extensionId ?? 'terraphim-editor';
    this.databaseName = options.databaseName ?? `${this.extensionId}:role-discovery:v1`;
    if (!identifier(this.extensionId) || !identifier(this.databaseName) || typeof this.Storage !== 'function') throw new RoleStorageError('invalid_input');
  }
  private assert(epoch = this.epoch): void {
    if (!this.enabled || this.closed || epoch !== this.epoch) throw new RoleStorageError('disabled');
    if (!this.indexedDB) throw new RoleStorageError('storage_unavailable');
  }
  /** Disabling never deletes the index, snapshots, or another writer's checkpoint. */
  setEnabled(enabled: boolean): void {
    if (this.closed) throw new RoleStorageError('disabled');
    if (this.enabled === enabled) return;
    this.enabled = enabled; this.epoch++;
    if (!enabled) this.closeHandles();
  }
  private closeHandles(): void {
    for (const tx of this.transactions) { try { tx.abort(); } catch { /* Already complete. */ } }
    for (const storage of this.storages) storage.close();
    this.storages.clear(); this.db?.close(); this.db = null;
  }
  close(): void { if (this.closed) return; this.closed = true; this.epoch++; this.closeHandles(); }
  private run<T>(work: (epoch: number) => Promise<T>): Promise<T> {
    const epoch = this.epoch;
    const result = this.tail.then(() => { this.assert(epoch); return work(epoch); });
    this.tail = result.catch(() => undefined); return result;
  }
  private open(): Promise<IDBDatabase> {
    this.assert(); if (this.db) return Promise.resolve(this.db); if (this.opening) return this.opening;
    const epoch = this.epoch;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let failed = false;
      const refuse = () => { failed = true; reject(new RoleStorageError('storage_unavailable')); };
      try { request = this.indexedDB.open(this.databaseName, 1); } catch { refuse(); return; }
      request.onupgradeneeded = () => {
        if (failed || !this.enabled || this.closed || epoch !== this.epoch) { request.transaction?.abort(); return; }
        request.result.createObjectStore('checkpoints');
      };
      request.onerror = refuse; request.onblocked = refuse;
      request.onsuccess = () => {
        const db = request.result;
        if (failed || !this.enabled || this.closed || epoch !== this.epoch || !db.objectStoreNames.contains('checkpoints')) { db.close(); refuse(); return; }
        db.onversionchange = () => this.close(); this.db = db; resolve(db);
      };
    }).finally(() => { this.opening = null; });
    return this.opening;
  }
  private async transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void, refuse: (code: RoleStorageErrorCode) => void) => void): Promise<T> {
    const epoch = this.epoch, db = await this.open(); this.assert(epoch);
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction; let value: T; let hasValue = false; let code: RoleStorageErrorCode = 'storage_unavailable';
      try { tx = db.transaction('checkpoints', mode); } catch { reject(new RoleStorageError(code)); return; }
      this.transactions.add(tx);
      const done = () => this.transactions.delete(tx);
      tx.oncomplete = () => { done(); if (hasValue) resolve(value); else reject(new RoleStorageError(code)); };
      tx.onerror = () => { /* Abort is the terminal failure. */ };
      tx.onabort = () => { done(); reject(new RoleStorageError(code)); };
      try { work(tx.objectStore('checkpoints'), result => { value = result; hasValue = true; }, reason => { code = reason; tx.abort(); }); }
      catch { try { tx.abort(); } catch { done(); reject(new RoleStorageError(code)); } }
    });
  }
  private key(input: RoleIdentity): IDBValidKey[] { return [1, this.extensionId, input.workspace, input.role, input.session]; }
  private storage(namespace: string): SnapshotStorage {
    this.assert(); const storage = new this.Storage({ enabled: true, namespace, indexedDB: this.indexedDB }); this.storages.add(storage); return storage;
  }
  private async load(row: IndexRow, epoch: number): Promise<string> {
    if (row.namespace !== await roleNamespace(this.extensionId, row.identity)) throw new RoleStorageError('storage_unavailable');
    this.assert(epoch); const storage = this.storage(row.namespace);
    try {
      const text = await storage.load(); this.assert(epoch);
      if (!snapshotValid(text) || encoder.encode(text).byteLength !== row.bytes || await sha256Utf8(text) !== row.sha256) throw new RoleStorageError('storage_unavailable');
      this.assert(epoch); return text;
    } finally { storage.close(); this.storages.delete(storage); }
  }
  private async reserve(input: RoleIdentity, snapshot: string, epoch: number, requireNew: boolean): Promise<IndexRow> {
    const namespace = await roleNamespace(this.extensionId, input), sha256 = await sha256Utf8(snapshot); this.assert(epoch);
    const row: IndexRow = { schema: 1, extensionId: this.extensionId, identity: input, namespace, checkpointId: crypto.randomUUID(), owner: this.owner,
      sha256, bytes: encoder.encode(snapshot).byteLength, updatedAt: new Date().toISOString(), state: 'pending' };
    await this.transaction<void>('readwrite', (store, result, refuse) => {
      const prior = store.get(this.key(input));
      prior.onsuccess = () => {
        if (requireNew && prior.result !== undefined) { refuse('new_session_required'); return; }
        if (prior.result !== undefined && (!validRow(prior.result, input, this.extensionId) || prior.result.owner !== this.owner)) { refuse('writer_conflict'); return; }
        store.put(row, this.key(input)); result(undefined);
      };
    });
    this.assert(epoch); return row;
  }
  private async persist(row: IndexRow, snapshot: string, epoch: number): Promise<RoleCandidate> {
    this.assert(epoch); const storage = this.storage(row.namespace);
    try {
      await storage.save(snapshot); this.assert(epoch);
      const actual = await storage.load(); this.assert(epoch);
      if (actual !== snapshot || await sha256Utf8(actual) !== row.sha256) throw new RoleStorageError('storage_unavailable');
      this.assert(epoch);
      await this.transaction<void>('readwrite', (store, result, refuse) => {
        const current = store.get(this.key(row.identity));
        current.onsuccess = () => {
          if (!validRow(current.result, row.identity, this.extensionId) || current.result.owner !== this.owner || current.result.checkpointId !== row.checkpointId) { refuse('writer_conflict'); return; }
          store.put({ ...row, state: 'ready' }, this.key(row.identity)); result(undefined);
        };
      });
      this.assert(epoch); return candidate(row);
    } catch (error) { throw error instanceof RoleStorageError ? error : new RoleStorageError('storage_unavailable'); }
    finally { storage.close(); this.storages.delete(storage); }
  }
  /** Caller supplies the existing engine's exportSnapshot output; never document synonyms or a fabricated KG. */
  checkpoint(input: RoleIdentity, snapshot: string): Promise<RoleCandidate> {
    const checked = identity(input);
    try { assertSnapshotRole(snapshot, checked.role); } catch (error) { return Promise.reject(error); }
    return this.run(async epoch => this.persist(await this.reserve(checked, snapshot, epoch, false), snapshot, epoch));
  }
  /** Listing never imports, activates or chooses a role. Candidate means exact stored bytes only. */
  list(scope: { workspace: string; role?: string }): Promise<RoleEntry[]> {
    const query = { workspace: scope.workspace, role: scope.role };
    if (!identifier(query.workspace) || (query.role !== undefined && !identifier(query.role))) return Promise.reject(new RoleStorageError('invalid_input'));
    return this.run(async epoch => {
      const rows = await this.transaction<{ identity: RoleIdentity; value: unknown }[]>('readonly', (store, result) => {
        const rows: { identity: RoleIdentity; value: unknown }[] = []; const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) { result(rows); return; }
          const key = entry.key;
          if (Array.isArray(key) && key.length === 5 && key[0] === 1 && key[1] === this.extensionId && key[2] === query.workspace && identifier(key[3]) && (query.role === undefined || key[3] === query.role) && identifier(key[4])) {
            rows.push({ identity: { workspace: query.workspace, role: key[3], session: key[4] }, value: entry.value });
          }
          entry.continue();
        };
      });
      this.assert(epoch); const entries: RoleEntry[] = [];
      for (const row of rows) {
        if (!validRow(row.value, row.identity, this.extensionId)) { entries.push({ status: 'unavailable', identity: row.identity, reason: 'invalid_record' }); continue; }
        if (row.value.state !== 'ready') { entries.push({ status: 'unavailable', identity: row.identity, reason: 'incomplete' }); continue; }
        try { await this.load(row.value, epoch); entries.push(candidate(row.value)); }
        catch { this.assert(epoch); entries.push({ status: 'unavailable', identity: row.identity, reason: 'missing_or_corrupt_snapshot' }); }
      }
      return entries;
    });
  }
  /** Only an explicit choice invokes the existing transactional Rust/client import path. */
  restore(selected: RoleCandidate, target: RoleIdentity, client: { importSnapshot(snapshot: string): Promise<unknown> }, options: { confirmed: boolean }): Promise<RoleCandidate> {
    if (options.confirmed !== true) return Promise.reject(new RoleStorageError('explicit_choice_required'));
    const source = identity(selected.identity), destination = identity(target);
    if (source.workspace !== destination.workspace || source.role !== destination.role) return Promise.reject(new RoleStorageError('identity_mismatch'));
    if (source.session === destination.session) return Promise.reject(new RoleStorageError('new_session_required'));
    const choice = { checkpointId: selected.checkpointId, sha256: selected.sha256 };
    return this.run(async epoch => {
      const row = await this.transaction<unknown>('readonly', (store, result) => { const r = store.get(this.key(source)); r.onsuccess = () => result(r.result); });
      this.assert(epoch);
      if (!validRow(row, source, this.extensionId) || row.state !== 'ready' || row.checkpointId !== choice.checkpointId || row.sha256 !== choice.sha256) throw new RoleStorageError('stale_selection');
      const snapshot = await this.load(row, epoch);
      assertSnapshotRole(snapshot, source.role);
      const reserved = await this.reserve(destination, snapshot, epoch, true);
      let imported = false;
      try {
        await client.importSnapshot(snapshot); imported = true; this.assert(epoch);
        return await this.persist(reserved, snapshot, epoch);
      } catch (error) {
        if (!imported) throw new RoleStorageError('import_refused');
        throw new RoleStorageError(error instanceof RoleStorageError ? error.code : 'storage_unavailable', true);
      }
    });
  }
}
