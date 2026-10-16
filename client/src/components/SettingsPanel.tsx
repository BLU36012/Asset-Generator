import {
  ENGINE_IDS,
  ENGINES,
  FORMATS,
  formatsForMode,
  type EngineId,
  type FormatId,
  type Mode,
  type Support,
} from '@asset-gen/shared';

const SUPPORT_LABEL: Record<Support, string> = {
  native: 'supported',
  partial: 'with caveats',
  none: 'not supported',
};

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div>
      <span className="field-label">Asset type</span>
      <div className="segmented" role="group" aria-label="Asset type">
        <button type="button" aria-pressed={mode === '3d'} onClick={() => onChange('3d')}>
          3D model
        </button>
        <button type="button" aria-pressed={mode === '2d'} onClick={() => onChange('2d')}>
          2D sprite
        </button>
      </div>
    </div>
  );
}

export function EngineSelect({ engine, onChange }: { engine: EngineId; onChange: (engine: EngineId) => void }) {
  const profile = ENGINES[engine];
  return (
    <label className="field">
      <span className="field-label">Target engine</span>
      <select value={engine} onChange={(e) => onChange(e.target.value as EngineId)}>
        {ENGINE_IDS.map((id) => (
          <option key={id} value={id}>
            {ENGINES[id].label}
          </option>
        ))}
      </select>
      <p className="hint" style={{ marginTop: 8 }}>
        Units: {profile.unitName}. Max texture {profile.maxTextureSize}px. {profile.importTip}
      </p>
    </label>
  );
}

interface FormatProps {
  mode: Mode;
  engine: EngineId;
  format: FormatId;
  onChange: (format: FormatId) => void;
}

export function FormatDropdown({ mode, engine, format, onChange }: FormatProps) {
  const info = FORMATS[format];
  const recommended = ENGINES[engine].recommended[mode];
  const note = info.notes?.[engine];

  return (
    <label className="field">
      <span className="field-label">Save as file type</span>
      <select value={format} onChange={(e) => onChange(e.target.value as FormatId)}>
        {formatsForMode(mode).map((f) => {
          const support = f.support[engine];
          const suffix = support === 'none' ? ' (not supported)' : f.id === recommended ? ' ★ recommended' : support === 'partial' ? ' (limited)' : '';
          return (
            <option key={f.id} value={f.id} disabled={support === 'none'}>
              {f.label}
              {suffix}
            </option>
          );
        })}
      </select>
      <p className="small muted" style={{ margin: '8px 0 6px' }}>
        {info.description}
      </p>
      <div className="badges" aria-label="Engine compatibility">
        {ENGINE_IDS.map((id) => (
          <span
            key={id}
            className={`badge ${info.support[id]} ${id === engine ? 'selected' : ''}`}
            title={info.notes?.[id] ?? SUPPORT_LABEL[info.support[id]]}
          >
            {ENGINES[id].label}: {SUPPORT_LABEL[info.support[id]]}
          </span>
        ))}
      </div>
      {note && <p className="note-warn" style={{ marginTop: 8 }}>{note}</p>}
    </label>
  );
}

/** Keeps the format valid when mode or engine changes. */
export function pickFormat(mode: Mode, engine: EngineId, current: FormatId): FormatId {
  const f = FORMATS[current];
  if (f.mode === mode && f.support[engine] !== 'none') return current;
  return ENGINES[engine].recommended[mode] as FormatId;
}
