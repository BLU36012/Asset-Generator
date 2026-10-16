import { useEffect, useState } from 'react';
import type { StatusResponse } from '@asset-gen/shared';
import { api } from '../api';

/** Shows the state of the server's AI model; the server starts and manages it on its own. */
export function TextModelStatus() {
  const [status, setStatus] = useState<StatusResponse | null | undefined>(undefined);
  const ready = status?.textModel?.state === 'ready' || status?.textModel?.available;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .status()
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus(null));
    void load();
    // Poll quickly while the server is still bringing the model up.
    const id = window.setInterval(load, ready ? 30_000 : 3_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [ready]);

  if (status === undefined) return null;
  const tm = status?.textModel;
  const refs = status?.references.enabled ? ' Web reference images are on.' : '';

  if (tm?.available) {
    return (
      <p className="status-pill ok" title={`${tm.provider} · ${tm.model}`}>
        ● AI model ready on the server (<strong>{tm.model}</strong>){tm.queued ? ` · ${tm.queued} request(s) in line` : ''}.{refs}
      </p>
    );
  }
  if (tm && (tm.state === 'starting' || tm.state === 'loading' || tm.state === 'downloading')) {
    const pct = tm.progress !== undefined ? ` ${Math.round(tm.progress * 100)}%` : '';
    return (
      <p className="status-pill busy" role="status">
        ◌ {tm.state === 'downloading' ? `The server is downloading the AI model…${pct}` : 'The AI model is starting on the server…'} Until then,
        text uses keyword matching.{refs}
      </p>
    );
  }
  return (
    <p className="status-pill off" title={tm?.reason}>
      ○ {tm ? 'The AI model is unavailable on the server' : 'The AI model is turned off on this server'}, so text uses keyword
      matching.{refs}
    </p>
  );
}
