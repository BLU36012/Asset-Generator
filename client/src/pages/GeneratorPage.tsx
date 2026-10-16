import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ENGINES, FORMATS, type Asset, type EngineId, type FormatId, type Mode, type ReferenceInfo, type ReferenceMode } from '@asset-gen/shared';
import { api, ApiError, errorMessage } from '../api';
import { AssetPreview } from '../components/AssetPreview';
import { InputPanel } from '../components/InputPanel';
import type { CaptureFn } from '../components/Preview3D';
import { FeedbackPanel } from '../components/FeedbackPanel';
import { EngineSelect, FormatDropdown, ModeToggle, pickFormat } from '../components/SettingsPanel';
import { TextModelStatus } from '../components/TextModelStatus';
import { useAuth } from '../context/AuthContext';
import { fromUploadId, type InputItem } from '../lib/inputs';

/**
 * Work-in-progress survives a trip to the sign-in page (and reloads) via
 * sessionStorage. Only already-uploaded inputs can be restored.
 */
interface Draft {
  mode: Mode;
  engine: EngineId;
  format: FormatId;
  prompt: string;
  name: string;
  inputs: { uploadId: string; kind: InputItem['kind'] }[];
  videoName: string | null;
  result: Asset | null;
  designId: string | null;
  referenceMode?: ReferenceMode;
}

const DRAFT_KEY = 'asset-generator:draft';

function loadDraft(): Draft | null {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
  } catch {
    return null;
  }
}

function storeDraft(draft: Draft | null) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage unavailable (private mode etc.); drafts just won't persist.
  }
}

const SOURCE_LABEL: Record<Asset['source'], (model: string | null) => string> = {
  'text-model': (model) => `Local AI text model (${model})`,
  'feedback-reuse': () => 'A previously liked design (AI model offline)',
  keywords: () => 'Keyword matching',
  image: () => 'Image analysis',
  'web-reference': () => 'A web reference image, modeled on the server',
};

/** Credits the openly licensed image a model was built from (CC licenses require attribution). */
function ReferenceCard({ reference }: { reference: ReferenceInfo }) {
  return (
    <div className="reference-card">
      <img src={reference.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
      <div>
        <div className="field-label" style={{ marginBottom: 2 }}>
          Reference image
        </div>
        <a href={reference.pageUrl} target="_blank" rel="noreferrer">
          {reference.title}
        </a>
        <div className="muted">
          {reference.author ? `by ${reference.author} · ` : ''}
          {reference.licenseUrl ? (
            <a href={reference.licenseUrl} target="_blank" rel="noreferrer">
              {reference.license}
            </a>
          ) : (
            reference.license
          )}{' '}
          · via {reference.provider}
        </div>
      </div>
    </div>
  );
}

const KEYWORDS =
  'crate, barrel, orb, cone, tree, rock, pillar, coin, gem, mushroom, house, sword, potion, star, heart';

export function GeneratorPage() {
  const { user, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  const [draft] = useState(loadDraft);

  const [mode, setMode] = useState<Mode>(draft?.mode ?? '3d');
  const [engine, setEngine] = useState<EngineId>(draft?.engine ?? 'unity');
  const [format, setFormat] = useState<FormatId>(draft?.format ?? ENGINES.unity.recommended['3d'] as FormatId);
  const [prompt, setPrompt] = useState(draft?.prompt ?? '');
  const [name, setName] = useState(draft?.name ?? '');
  const [items, setItems] = useState<InputItem[]>(() => draft?.inputs.map((i) => fromUploadId(i.uploadId, i.kind)) ?? []);
  const [videoName, setVideoName] = useState<string | null>(draft?.videoName ?? null);
  const [result, setResult] = useState<Asset | null>(draft?.result ?? null);
  const [designId, setDesignId] = useState<string | null>(draft?.designId ?? null);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>(draft?.referenceMode ?? 'auto');

  const [busy, setBusy] = useState<'generate' | 'design' | 'asset' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const captureRef = useRef<CaptureFn | null>(null);

  useEffect(() => {
    storeDraft({
      mode,
      engine,
      format,
      prompt,
      name,
      inputs: items.filter((i) => i.uploadId).map((i) => ({ uploadId: i.uploadId!, kind: i.kind })),
      videoName,
      result,
      designId,
      referenceMode,
    });
  }, [mode, engine, format, prompt, name, items, videoName, result, designId, referenceMode]);

  // Open a saved design from the library: /?design=<id>
  const designParam = params.get('design');
  useEffect(() => {
    if (!designParam || authLoading) return;
    if (!user) {
      setError('Sign in to open saved designs.');
      return;
    }
    api
      .getDesign(designParam)
      .then((d) => {
        setMode(d.settings.mode);
        setEngine(d.settings.engine);
        setFormat(pickFormat(d.settings.mode, d.settings.engine, d.settings.format));
        setPrompt(d.prompt);
        setName(d.name);
        setItems(d.uploadIds.map((id) => fromUploadId(id)));
        setVideoName(null);
        setResult(null);
        setDesignId(d.id);
        setError('');
        setNotice(`Opened design “${d.name}”. Press Generate to rebuild it.`);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setParams({}, { replace: true }));
  }, [designParam, user, authLoading, setParams]);

  const changeMode = (m: Mode) => {
    setMode(m);
    setFormat(pickFormat(m, engine, format));
  };

  const changeEngine = (e: EngineId) => {
    setEngine(e);
    setFormat(pickFormat(mode, e, format));
  };

  /** Uploads any inputs not yet on the server and returns every upload id, in order. */
  const ensureUploaded = async (): Promise<string[]> => {
    const pending = items.filter((i) => !i.uploadId && i.blob);
    if (pending.length === 0) return items.flatMap((i) => (i.uploadId ? [i.uploadId] : []));
    const uploads = await api.upload(pending.map((i) => ({ blob: i.blob!, name: i.fileName })));
    const idByKey = new Map(pending.map((p, n) => [p.key, uploads[n].id]));
    const next = items.map((i) => (idByKey.has(i.key) ? { ...i, uploadId: idByKey.get(i.key), blob: undefined } : i));
    setItems(next);
    return next.flatMap((i) => (i.uploadId ? [i.uploadId] : []));
  };

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    run('generate', async () => {
      const uploadIds = await ensureUploaded();
      setResult(await api.generate({ mode, prompt, uploadIds, engine, format, name: name.trim() || undefined, referenceMode }));
    });

  const saveDesign = (asNew = false) =>
    run('design', async () => {
      const uploadIds = await ensureUploaded();
      const input = {
        name: name.trim() || prompt.trim().slice(0, 40) || 'Untitled design',
        prompt,
        settings: { mode, engine, format },
        uploadIds,
      };
      try {
        const updating = designId && !asNew;
        const saved = updating ? await api.updateDesign(designId, input) : await api.createDesign(input);
        setDesignId(saved.id);
        setNotice(updating ? 'Design updated.' : 'Design saved to your library.');
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) setDesignId(null); // it was deleted elsewhere
        throw err;
      }
    });

  const saveAsset = () =>
    run('asset', async () => {
      if (!result) return;
      const thumbnail = result.mode === '3d' ? (captureRef.current?.() ?? undefined) : undefined;
      const saved = await api.saveAsset(result.id, { name: name.trim() || result.name, designId, thumbnail });
      setResult(saved);
      setNotice('Asset saved to your library.');
    });

  const startOver = () => {
    setPrompt('');
    setName('');
    setItems([]);
    setVideoName(null);
    setResult(null);
    setDesignId(null);
    setError('');
    setNotice('');
  };

  const canGenerate = prompt.trim().length > 0 || items.length > 0;

  return (
    <div className="generator">
      <section className="panel stack" aria-labelledby="create-heading">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1 id="create-heading" style={{ margin: 0 }}>
            Create an asset
          </h1>
          <button type="button" className="btn btn-sm" onClick={startOver}>
            Start over
          </button>
        </div>
        {designId && <p className="small muted">Editing a saved design. Saving will update it.</p>}

        <ModeToggle mode={mode} onChange={changeMode} />
        <InputPanel
          prompt={prompt}
          onPromptChange={setPrompt}
          items={items}
          onItemsChange={setItems}
          videoName={videoName}
          onVideoNameChange={setVideoName}
        />
        <EngineSelect engine={engine} onChange={changeEngine} />
        <FormatDropdown mode={mode} engine={engine} format={format} onChange={setFormat} />
        <label className="field">
          <span className="field-label">Web reference images</span>
          <select value={referenceMode} onChange={(e) => setReferenceMode(e.target.value as ReferenceMode)}>
            <option value="auto">Auto: for people, animals, weapons and other hard objects (recommended)</option>
            <option value="always">Always look for a reference image</option>
            <option value="never">Never (design from the text only)</option>
          </select>
          <span className="small muted">Only used when you haven't added your own photo or video. Images come from Wikimedia Commons and Openverse (openly licensed).</span>
        </label>
        <label className="field">
          <span className="field-label">Name (optional)</span>
          <input type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Taken from the prompt if empty" />
        </label>

        <TextModelStatus />
        <button type="button" className="btn btn-primary btn-lg" disabled={!canGenerate || busy !== null} onClick={generate}>
          {busy === 'generate' ? 'Generating…' : `Generate ${mode === '3d' ? '3D model' : '2D sprite'}`}
        </button>

        <div className="hint">
          <p>
            <strong>Text:</strong> with the local AI model running, any description works ("a key", "a steampunk
            lantern"). The model designs the object part by part. Without it, the generator falls back to keywords
            ({KEYWORDS}).
          </p>
          <p>
            <strong>Photos and video</strong> are analyzed, not pasted on. The object's outline, symmetry and colors are
            modeled. When you also give text, <strong>the text takes priority</strong> and the image fills in the rest.
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Feedback:</strong> rate each result. Liked and disliked designs (yours count most) guide future
            generations of similar prompts.
          </p>
        </div>
      </section>

      <section className="panel stack" aria-labelledby="preview-heading" aria-busy={busy === 'generate'}>
        <h2 id="preview-heading">Preview</h2>
        <div className="preview-box">
          {result ? (
            <AssetPreview asset={result} captureRef={captureRef} />
          ) : (
            <div className="preview-empty">
              <p>Your generated asset will appear here.</p>
              <p className="small">Describe it, drop in a photo or video, pick an engine and a file type, then press Generate.</p>
            </div>
          )}
          {busy === 'generate' && (
            <div className="preview-empty" style={{ background: 'rgba(7, 11, 22, 0.7)' }}>
              <div className="spinner" aria-label="Generating" />
              {prompt.trim() && <p className="small" style={{ marginTop: 12 }}>Designing… a local AI model can take 5–30 seconds.</p>}
            </div>
          )}
        </div>

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            {notice}
          </div>
        )}

        {result && (
          <>
            <div>
              <span className="field-label">How it was interpreted</span>
              <ul className="notes">
                {result.summary
                  .split('\n')
                  .filter(Boolean)
                  .map((line) => (
                    <li key={line}>{line}</li>
                  ))}
              </ul>
            </div>
            {result.reference && <ReferenceCard reference={result.reference} />}
            <FeedbackPanel asset={result} onRated={setResult} onTryAgain={generate} busy={busy !== null} signedIn={Boolean(user)} />
            <dl className="result-meta">
              <dt>Made by</dt>
              <dd>{SOURCE_LABEL[result.source]?.(result.model) ?? 'Unknown'}</dd>
              <dt>File</dt>
              <dd>{result.fileName}</dd>
              <dt>Type</dt>
              <dd>{FORMATS[result.format].label}</dd>
              <dt>Engine</dt>
              <dd>{ENGINES[result.engine].label}</dd>
              <dt>Status</dt>
              <dd>{result.saved ? 'Saved to your library' : 'Not saved (temporary files are deleted after 24 hours)'}</dd>
            </dl>
            <div className="row">
              <a className="btn btn-primary" href={result.downloadUrl} download={result.fileName}>
                Download
              </a>
              {user ? (
                <>
                  <button type="button" className="btn" disabled={busy !== null || result.saved} onClick={saveAsset}>
                    {result.saved ? 'Asset saved ✓' : busy === 'asset' ? 'Saving…' : 'Save asset'}
                  </button>
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => saveDesign()}>
                    {busy === 'design' ? 'Saving…' : designId ? 'Update design' : 'Save design'}
                  </button>
                  {designId && (
                    <button type="button" className="btn" disabled={busy !== null} onClick={() => saveDesign(true)}>
                      Save as new design
                    </button>
                  )}
                </>
              ) : (
                <span className="small">
                  <Link to="/login" state={{ from: '/' }}>
                    Sign in
                  </Link>{' '}
                  or{' '}
                  <Link to="/register" state={{ from: '/' }}>
                    create an account
                  </Link>{' '}
                  to save this asset and its design.
                </span>
              )}
            </div>
          </>
        )}

        {!result && user && canGenerate && (
          <button type="button" className="btn" disabled={busy !== null} onClick={() => saveDesign()}>
            {busy === 'design' ? 'Saving…' : designId ? 'Update design' : 'Save design'}
          </button>
        )}
      </section>
    </div>
  );
}
