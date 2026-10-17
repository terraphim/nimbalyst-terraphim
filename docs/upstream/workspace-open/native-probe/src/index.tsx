import React, {useRef, useState} from 'react';
import {useEditorLifecycle} from '@nimbalyst/extension-sdk';
import type {EditorHostProps, EditorWorkspaceFileOpenResult} from '@nimbalyst/extension-sdk';

/** Development-host verification fixture; it never calls Electron or a private host API. */
export function WorkspaceOpenProbe({host}: EditorHostProps) {
  const text = useRef('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<EditorWorkspaceFileOpenResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [beforeOpen, setBeforeOpen] = useState<unknown>(null);
  const [afterOpen, setAfterOpen] = useState<unknown>(null);
  const [, refresh] = useState(0);
  const lifecycle = useEditorLifecycle(host, {
    applyContent(value: string) { text.current = value; setContent(value); },
    getCurrentContent() { return text.current; },
  });
  const dirty = useRef(false);
  dirty.current = lifecycle.isDirty;
  const readback = () => ({
    filePath: host.filePath, workspaceId: host.workspaceId ?? null,
    hostIsActive: host.isActive, localDirty: dirty.current,
    buffer: text.current, bufferUtf8Bytes: new TextEncoder().encode(text.current).length,
  });
  const open = async () => {
    if (busy || !host.openWorkspaceFile) return;
    setBusy(true); setFailure(null); setOutcome(null); setAfterOpen(null);
    setBeforeOpen(readback());
    try {
      const result = await host.openWorkspaceFile();
      setOutcome(result); setAfterOpen(readback());
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setAfterOpen(readback());
    } finally { setBusy(false); }
  };
  return <section aria-label="Workspace Open verification probe" style={{padding:16,display:'grid',gap:12}}>
    <h2>Workspace Open verification probe</h2>
    <p>This is a development-host verification fixture; not a released Terraphim feature.</p>
    {lifecycle.error && <p role="alert">{lifecycle.error.message}</p>}
    <label>Probe document buffer
      <textarea aria-label="Probe document buffer" value={content}
        disabled={lifecycle.isLoading || Boolean(lifecycle.error)}
        onChange={event => {text.current=event.currentTarget.value;setContent(text.current);lifecycle.markDirty();}}
        style={{display:'block',width:'100%',minHeight:100}} />
    </label>
    <button type="button" onClick={() => void open()}
      disabled={busy || lifecycle.isLoading || !host.openWorkspaceFile}>
      {busy ? 'Native chooser pending' : 'Open workspace file through custom-editor API'}
    </button>
    {!host.openWorkspaceFile && <p role="status">Optional host capability is absent; no chooser was called.</p>}
    <button type="button" onClick={() => refresh(value => value + 1)}>Refresh host and buffer readback</button>
    <pre aria-label="Actual probe readback">{JSON.stringify({
      current:readback(),beforeOpen,afterOpen,outcome,failure,
      nativeTabReadback:'Observe the actual host tab bar separately; no private tab-store access is used.',
    },null,2)}</pre>
  </section>;
}

export const components = {WorkspaceOpenProbe};
