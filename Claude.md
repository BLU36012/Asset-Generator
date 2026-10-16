# Asset Generator: notes for Claude

npm-workspaces monorepo: `shared/` (TS types + format/engine matrix), `server/` (Express 5 + `node:sqlite`, run with tsx), `client/` (React 19 + Vite 8).

## Commands
- `npm run dev`: API on :4000 and Vite on :5173 (proxies `/api`)
- `npm test`: server Vitest suite (`server/test/`)
- `npm run typecheck`: all three workspaces (TypeScript 7)

## Conventions
- **UI theme:** Arial everywhere. Neon-blue text (`--neon` #1f8fff, `--neon-bright` #00d4ff) on a dark navy background. All colors are CSS variables in `client/src/styles/theme.css`, so add new colors there.
- **Format/engine data:** `shared/src/formats.ts` and `shared/src/engines.ts` are the only source of truth. The dropdown, server validation and badges all read from them.
- **Mock pipeline** (`server/src/generators/mock/`): `promptParser` → `imageAnalysis` (segmentation, symmetry axis, outline/holes, palette, bands, regions) → `interpret` (merges both into an `AssetSpec`; **text always wins**, and every decision is pushed to `notes` for the UI) → `mesh3d` / `sprite2d` build from the spec. Never use an input photo directly as a texture.
- **Text model** (`server/src/generators/llm/`): Ollama returns a *relative* `LayoutDesign` (constrained by `LAYOUT_SCHEMA`), and `layout.ts` resolves it into an absolute `Blueprint`. Don't ask the model for coordinates; small models can't do the math. Few-shot examples come from `library.ts` (nearest by token similarity) plus liked feedback. Add common props to the library to improve results. Tests use `fakeTextModel` (`test/fixtures.ts`) and never hit a real Ollama server.
- **Feedback** (`server/src/feedback.ts`): ratings copy the prompt and `generation_json` (they must outlive temporary assets). Retrieval weighting: own ×3, 60-day half-life, Jaccard similarity ≥ 0.25. Dislike guidance must say "fix X while keeping it a recognizable Y". Telling small models to "be different" makes them drift off the object.
- **Server-managed AI** (`server/src/generators/llm/manager.ts`): `ManagedOllama` auto-starts `ollama serve` (local URLs only), auto-pulls the model, preloads it and serializes requests (bounded queue). The browser never talks to the model. Docker: `docker-compose.yml` runs Ollama as a separate service (`OLLAMA_AUTOSTART=false`).
- **Web references** (`server/src/references/`, `generators/mock/referencePick.ts`, `subjects.ts`): image fetches are restricted to the provider hosts in `ALLOWED_IMAGE_HOSTS`. Reference picking rejects scenes, maps, multi-object and wrong-proportion images; new hard subjects go in `SUBJECTS` (size, silhouette limits, depth). Probe the real search before tuning phrasings (`queryVariants`); "transparent background" is the best Commons phrasing. Tests use a fake finder and never hit the network.
- **Generators:** implement `AssetGenerator` (`server/src/generators/types.ts`). Mesh data is meters, Y-up, pivot at the bottom-center; UVs use glTF convention (v=0 at top). Exporters flip V for OBJ/FBX.
- **Engine scaling:** applies to OBJ only (`objScale`). glTF is meters by spec, and FBX declares `UnitScaleFactor=100`.
- **Routers:** factories take an `AppContext` (db, paths, secret). Throw `HttpError` from handlers; Express 5 forwards async errors.
- **Assets:** unsaved assets are capability URLs (UUID) readable by anyone holding the link. Saved ones are owner-only. Uploads start unowned and are claimed when a design is saved.
- **Runtime data:** everything lives in `server/storage/` (gitignored).
- **Dependency versions:** archiver 8 uses the class API (`new ZipArchive()`), not the old `archiver('zip')` call.
