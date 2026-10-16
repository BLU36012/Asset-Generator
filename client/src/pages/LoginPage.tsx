import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel auth-card stack" onSubmit={submit}>
      <h1>Sign in</h1>
      <p className="muted">Sign in to save your designs and assets to your library.</p>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <label className="field">
        <span className="field-label">Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button className="btn btn-primary btn-lg" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="small muted">
        New here?{' '}
        <Link to="/register" state={{ from }}>
          Create an account
        </Link>
      </p>
    </form>
  );
}
