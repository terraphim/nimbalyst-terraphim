/** Actual filesystem exports through the pinned upstream ProjectFileService. */
import type { Page } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { controllerFixture } from './controller-fixture.ts';

export async function exportFixture(page: Page, timeoutMs = 2000) {
 const base = await controllerFixture(page, 'Risk requires a Decision.\n');
 const {ProjectFileService} = await import(pathToFileURL(join(process.cwd(), '.cache/contracts/ProjectFileService.mjs')).href);
 const historyDirectory = join(base.workspace, '.history');
 await mkdir(historyDirectory);
 let sequence = 0, beforeWrite: (() => Promise<void>) | null = null;
 let afterWrite: ((destination: string) => Promise<void>) | null = null;
 const dirty = new Set<string>(), edits: unknown[] = [];
 const service = new ProjectFileService({
  async createSnapshot(filePath: string, content: string, type: string, description: string, metadata: unknown) {
   await writeFile(join(historyDirectory, `${++sequence}.json`), JSON.stringify({filePath, content, type, description, metadata}));
  },
 }, (filePath: string) => dirty.has(filePath));
 await page.exposeBinding('exportFiles', async (_, operation: {kind: string; paths?: string[]; edit?: any}) => {
  if (operation.kind === 'read') return service.read(base.workspace, operation.paths);
  if (operation.kind === 'write') {
   edits.push(operation.edit);
   if (beforeWrite) await beforeWrite();
   const receipt = await service.write(base.workspace, operation.edit);
   if (afterWrite) await afterWrite(operation.edit.changes[0].path);
   return receipt;
  }
  throw Error('Unsupported actual filesystem operation');
 });
 try {await page.evaluate(async timeoutMs => {
  const w = window as any;
  w.host.fs = {read: (paths: string[]) => w.exportFiles({kind: 'read', paths}), write: (edit: unknown) => w.exportFiles({kind: 'write', edit})};
  const module = '/src/exports.ts';
  const {ExportCoordinator, RustExportDeriver} = await import(module);
  // A distinct actual WASM module instance: export derivation cannot reset the editing engine.
  const engineURL = '/vendor/terraphim_editor.js?export-instance=' + crypto.randomUUID();
  const engine = await import(engineURL); await engine.default('/vendor/terraphim_editor_bg.wasm');
  w.exportEngine = engine;
  w.deriver = new RustExportDeriver(engine);
  w.exporter = new ExportCoordinator({controller: w.controller, host: w.host, supports: w.controllerOptions.supports,
   isCurrent: () => w.active, derive: async (source: string) => {w.deriveStarted = true; if (w.deriveGate) await w.deriveGate; return w.deriver.derive(source);}, timeoutMs});
  w.author = async () => {
   w.wasm.open_document('Risk requires a Decision.\n');
   w.wasm.alt_create_span('word', 0, 4, 'Concern', 'human');
   w.wasm.set_active_alternative('s1', 1);
   const source = w.wasm.save_document();
   await w.controller.accept(w.propose(source, 1));
   return source;
  };
 }, timeoutMs);} catch (error) {await base.cleanup(); throw error;}
 return {...base, edits, dirty, historyDirectory,
  destination: (name: string) => join(base.workspace, name),
  beforeWrite: (fn: () => Promise<void>) => {beforeWrite = fn;},
  afterWrite: (fn: (destination: string) => Promise<void>) => {afterWrite = fn;},
  readDestination: (name: string) => readFile(join(base.workspace, name), 'utf8'),
  cleanup: async () => {await page.evaluate(() => (window as any).exporter?.dispose()).catch(() => {}); await base.cleanup();},
 };
}
