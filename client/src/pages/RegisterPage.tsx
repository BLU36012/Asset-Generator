import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../context/AuthContext';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(email, password, displayName);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel auth-card stack" onSubmit={submit}>
      <h1>Create account</h1>
      <p className="muted">Your designs and generated assets are saved to your profile.</p>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <label className="field">
        <span className="field-label">Display name</span>
        <input
          type="text"
          autoComplete="nickname"
          maxLength={60}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Optional"
        />
      </label>
      <label className="field">
        <span className="field-label">Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="small muted">At least 8 characters.</span>
      </label>
      <button className="btn btn-primary btn-lg" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account'}
      </button>
      <p className="small muted">
        Already have an account?{' '}
        <Link to="/login" state={{ from }}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
