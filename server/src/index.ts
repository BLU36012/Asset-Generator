import { createApp } from './app';
import { cleanupExpired } from './cleanup';
import { createContext } from './context';
import { getGenerator } from './generators';

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on real environment variables.
}

const port = Number(process.env.PORT) || 4000;
const ctx = createContext({
  storageDir: process.env.STORAGE_DIR || './storage',
  jwtSecret: process.env.JWT_SECRET,
  // HTTPS-only cookies in production by default; COOKIE_SECURE=false allows plain-HTTP setups (e.g. local Docker).
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
});

const generator = getGenerator(); // fail fast on a bad GENERATOR value
const app = createApp(ctx);

const runCleanup = () =>
  cleanupExpired(ctx).catch((err) => console.error('Cleanup failed:', err));
void runCleanup();
setInterval(runCleanup, 60 * 60 * 1000).unref();

app.listen(port, () => {
  console.log(`Asset Generator API on http://localhost:${port} (generator: ${generator.id})`);
});

// The server owns the AI model: start/download/preload it in the background (generation
// falls back to keywords until it's ready), and stop anything we started on shutdown.
void ctx.textModel?.warmUp?.();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    ctx.textModel?.stop?.();
    process.exit(0);
  });
}
process.on('exit', () => ctx.textModel?.stop?.());
