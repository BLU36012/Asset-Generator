import { useEffect, useState } from 'react';
import type { Asset } from '@asset-gen/shared';
import { api, errorMessage } from '../api';

interface Props {
  asset: Asset;
  onRated: (asset: Asset) => void;
  /** Regenerate with the new feedback taken into account. */
  onTryAgain: () => void;
  busy: boolean;
  signedIn: boolean;
}

/** "Do you like this result?" Ratings (and reasons) steer future generations. */
export function FeedbackPanel({ asset, onRated, onTryAgain, busy, signedIn }: Props) {
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [commentSent, setCommentSent] = useState(false);

  useEffect(() => {
    setComment('');
    setError('');
    setCommentSent(false);
  }, [asset.id]);

  const send = async (liked: boolean, withComment = false) => {
    setSending(true);
    setError('');
    try {
      onRated(await api.sendFeedback(asset.id, { liked, comment: withComment ? comment : undefined }));
      if (withComment) setCommentSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const vote = asset.feedback;

  return (
    <div className="feedback" aria-live="polite">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="field-label" style={{ margin: 0 }}>
          Do you like this result?
        </span>
        <div className="row" role="group" aria-label="Rate this result">
          <button type="button" className={`btn btn-sm ${vote === 'like' ? 'btn-primary' : ''}`} aria-pressed={vote === 'like'} disabled={sending} onClick={() => send(true)}>
            👍 Yes
          </button>
          <button type="button" className={`btn btn-sm ${vote === 'dislike' ? 'btn-primary' : ''}`} aria-pressed={vote === 'dislike'} disabled={sending} onClick={() => send(false)}>
            👎 No
          </button>
        </div>
      </div>

      {vote === 'like' && (
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Thanks! Designs like this will be favored for similar prompts{signedIn ? ', especially yours' : ''}.
        </p>
      )}

      {vote === 'dislike' && (
        <div className="stack" style={{ marginTop: 10 }}>
          <label className="field">
            <span className="small">What should be different? (optional, helps the next attempt)</span>
            <textarea
              value={comment}
              maxLength={500}
              onChange={(e) => {
                setComment(e.target.value);
                setCommentSent(false);
              }}
              placeholder="e.g. make the handle longer, use darker metal"
              style={{ minHeight: 64 }}
            />
          </label>
          <div className="row">
            <button type="button" className="btn btn-sm" disabled={sending || !comment.trim() || commentSent} onClick={() => send(false, true)}>
              {commentSent ? 'Reason saved ✓' : 'Save reason'}
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || sending} onClick={onTryAgain}>
              Try again with this feedback
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="alert" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
