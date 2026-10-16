import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ENGINES, FORMATS, type Asset, type Design } from '@asset-gen/shared';
import { api, errorMessage } from '../api';
import { AssetPreview } from '../components/AssetPreview';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function LibraryPage() {
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<Design[] | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [viewing, setViewing] = useState<Asset | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.listDesigns(), api.listAssets()])
      .then(([d, a]) => {
        setDesigns(d);
        setAssets(a);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewing(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing]);

  const deleteDesign = async (d: Design) => {
    if (!window.confirm(`Delete the design “${d.name}”? Saved assets made from it are kept.`)) return;
    try {
      await api.deleteDesign(d.id);
      setDesigns((list) => list?.filter((x) => x.id !== d.id) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const deleteAsset = async (a: Asset) => {
    if (!window.confirm(`Delete the asset “${a.name}”? This removes its files permanently.`)) return;
    try {
      await api.deleteAsset(a.id);
      setAssets((list) => list?.filter((x) => x.id !== a.id) ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (error && !designs) {
    return (
      <div className="alert" role="alert">
        {error}
      </div>
    );
  }

  if (!designs || !assets) {
    return (
      <div className="full-center">
        <div className="spinner" aria-label="Loading library" />
      </div>
    );
  }

  return (
    <div>
      <h1>My Library</h1>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      <div className="section-head">
        <h2 style={{ margin: 0 }}>Saved assets ({assets.length})</h2>
        <Link to="/" className="btn btn-sm btn-primary">
          + New asset
        </Link>
      </div>
      {assets.length === 0 ? (
        <div className="empty">
          No saved assets yet. Generate something and press <strong>Save asset</strong>.
        </div>
      ) : (
        <div className="grid">
          {assets.map((a) => (
            <article className="card" key={a.id}>
              <div className={`card-thumb ${a.mode === '2d' ? 'checker' : ''}`}>
                {a.thumbnailUrl ? (
                  <img src={a.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <span className="placeholder" aria-hidden>
                    ⬡
                  </span>
                )}
              </div>
              <div className="card-body">
                <div className="card-title">{a.name}</div>
                <div className="badges">
                  <span className="badge">{a.mode.toUpperCase()}</span>
                  <span className="badge">{FORMATS[a.format].label.split(' ')[0]}</span>
                  <span className="badge">{ENGINES[a.engine].label}</span>
                </div>
                <span className="small muted">{dateFmt.format(new Date(a.createdAt))}</span>
                <div className="card-actions">
                  <button className="btn btn-sm" onClick={() => setViewing(a)}>
                    View
                  </button>
                  <a className="btn btn-sm" href={a.downloadUrl} download={a.fileName}>
                    Download
                  </a>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteAsset(a)}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="section-head">
        <h2 style={{ margin: 0 }}>Saved designs ({designs.length})</h2>
      </div>
      {designs.length === 0 ? (
        <div className="empty">
          No saved designs yet. A design keeps your prompt, photos and settings so you can regenerate later.
        </div>
      ) : (
        <div className="grid">
          {designs.map((d) => (
            <article className="card" key={d.id}>
              <div className="card-thumb">
                {d.uploadIds.length > 0 ? (
                  <img src={`/api/uploads/${d.uploadIds[0]}`} alt="" loading="lazy" style={{ objectFit: 'cover' }} />
                ) : (
                  <span className="placeholder" aria-hidden>
                    {d.settings.mode === '3d' ? '⬡' : '◩'}
                  </span>
                )}
              </div>
              <div className="card-body">
                <div className="card-title">{d.name}</div>
                {d.prompt && <p className="small" style={{ margin: 0 }}>“{d.prompt.length > 120 ? d.prompt.slice(0, 120) + '…' : d.prompt}”</p>}
                <div className="badges">
                  <span className="badge">{d.settings.mode.toUpperCase()}</span>
                  <span className="badge">{FORMATS[d.settings.format].label.split(' ')[0]}</span>
                  <span className="badge">{ENGINES[d.settings.engine].label}</span>
                  {d.uploadIds.length > 0 && <span className="badge">{d.uploadIds.length} image(s)</span>}
                </div>
                <span className="small muted">Updated {dateFmt.format(new Date(d.updatedAt))}</span>
                <div className="card-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => navigate(`/?design=${d.id}`)}>
                    Open
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteDesign(d)}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {viewing && (
        <div className="modal-backdrop" onClick={() => setViewing(null)}>
          <div
            className="panel modal stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="viewer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 id="viewer-title" style={{ margin: 0 }}>
                {viewing.name}
              </h2>
              <button className="btn btn-sm" onClick={() => setViewing(null)} autoFocus>
                Close
              </button>
            </div>
            <div className="preview-box">
              <AssetPreview asset={viewing} />
            </div>
            {viewing.prompt && <p className="small">Prompt: “{viewing.prompt}”</p>}
            <div className="row">
              <a className="btn btn-primary" href={viewing.downloadUrl} download={viewing.fileName}>
                Download {viewing.fileName}
              </a>
              <span className="small muted">{ENGINES[viewing.engine].importTip}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
