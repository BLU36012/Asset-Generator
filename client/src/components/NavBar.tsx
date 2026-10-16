import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function NavBar() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  const signOut = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="nav">
      <Link to="/" className="brand">
        <img src="/favicon.svg" alt="" width={26} height={26} />
        Asset Generator
      </Link>
      <nav className="nav-links" aria-label="Main">
        <NavLink to="/" end>
          Generator
        </NavLink>
        <NavLink to="/library">My Library</NavLink>
      </nav>
      <div className="nav-user">
        {loading ? null : user ? (
          <>
            <span className="small">
              Signed in as <strong>{user.displayName}</strong>
            </span>
            <button className="btn btn-sm" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link className="btn btn-sm" to="/login">
              Sign in
            </Link>
            <Link className="btn btn-sm btn-primary" to="/register">
              Create account
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
