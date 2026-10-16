# Asset-Generator

Generate game-ready **3D models** and **2D sprites** from a text prompt, a photo and/or a video, and export them for **Unity, Godot, Roblox Studio and Unreal Engine**. Users can sign in to save their designs and assets to a personal library.

> All AI runs **on the server**:
> - A language model ([Ollama](https://ollama.com)), which the server starts and manages itself, designs objects from any text description.
> - For people, animals, weapons and other objects that are hard to build from simple shapes, the server finds an **openly licensed reference image online** (Wikimedia Commons, Openverse) and models from it.
> - Uploaded photos and videos are *analyzed* to infer the object's form.
>
> Every result can be rated, and ratings steer future generations. Website visitors never install anything.

## Quick start

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`). Tested on Node 24.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:4000, and Vite proxies `/api` to it.

| Command | What it does |
| --- | --- |
| `npm run dev` | API (tsx watch) + client (Vite) together |
| `npm test` | Server tests (Vitest + Supertest) |
| `npm run typecheck` | Typecheck `shared`, `server` and `client` |
| `npm run build` then `npm start` | Build the client; the API then serves it on :4000 |

Optional settings live in `server/.env` (see [server/.env.example](server/.env.example)).

### The server-managed AI model

The AI model runs on the **server machine**, never in the browser. The API server manages it:
- If nothing answers at `OLLAMA_URL`, it starts `ollama serve` itself.
- It downloads `OLLAMA_MODEL` if it's missing (download progress shows in the UI) and preloads it.
- It runs one design at a time on the GPU, with a short queue.
- It stops any Ollama process it started when it shuts down.

Until the model is ready, text falls back to keyword matching and the status badge says so.

The only one-time step, done by whoever runs the server, is installing the Ollama runtime:

```bash
winget install Ollama.Ollama      # Windows; see https://ollama.com for macOS/Linux
```

Or use Docker (below), which includes it. The model downloads automatically on first start.

**Model choice:**
- `qwen2.5:3b` is the default (~2 GB) and fits a 4 GB GPU.
- For better designs of unusual objects, use `qwen2.5:7b` (needs about 8 GB VRAM, otherwise it's slow): set `OLLAMA_MODEL=qwen2.5:7b`.
- `TEXT_MODEL=none` turns the model off.

### Deploy with Docker

```bash
docker compose up -d     # then open http://localhost:4000
```

This runs two containers: the app, and an `ollama` service that holds the model. The app connects to it and downloads the model on first start. Models and app data persist in named volumes.
- For an NVIDIA GPU, uncomment the `deploy` block in [docker-compose.yml](docker-compose.yml).
- Behind HTTPS, set `COOKIE_SECURE=true`.

## Features

- **Inputs:** a text prompt, up to 4 photos (PNG/JPG/WebP) and/or a video. The browser extracts 4 key frames from the video, which are sent as images.
- **Asset type:** 3D model or 2D sprite.
- **Target engine:** Unity, Godot, Roblox Studio or Unreal Engine. This sets unit scaling (OBJ), texture size limits (Roblox max 1024 px) and the recommended format.
- **File type dropdown:** shows which engines can import each format. Formats an engine can't import are disabled.

  | 3D | 2D |
  | --- | --- |
  | GLB, glTF (zip), OBJ + MTL (zip), FBX (ASCII 7.4) | PNG, JPG, TGA, Sprite sheet (PNG + JSON, zip) |

- **Live preview:** an orbitable 3D viewer (three.js), or an animated sprite preview.
- **Accounts:** email and password sign-in, with a session in an httpOnly cookie. Guests can generate and download; signing in lets you **save assets** and **save designs** (prompt, images and settings) and reopen them later from **My Library**.
- Unsaved assets and unclaimed uploads are deleted after 24 hours.

### How text is interpreted

When the text model is available, it turns any description ("a key", "steampunk lantern", "treasure chest") into a **parts layout**. Each part has:
- a shape (box, sphere, cylinder, cone, torus, capsule, pyramid, wedge or dome)
- a real-world size
- what it attaches to and where (on top, below, left of, at the corners…)
- a color and a material

Small models are poor at 3D coordinate math, so the app's layout engine works out the exact positions. To help the model, it sees the most similar **reference designs** as worked examples: a built-in library of common props, plus designs users have liked. The same blueprint builds the 3D mesh (at real-world scale, with a material per part) or a shaded, outlined 2D sprite.

If the model is offline or fails, the app falls back to keyword matching, or reuses a liked design for a near-identical prompt.

### Web reference images (people, animals, weapons…)

Simple shapes can't capture a person, a horse or a rifle, so for prompts the app doesn't already know how to build, the server works from a reference photo. The Generator's **Web reference images** setting can be **Auto** (the default), **Always** or **Never**. The server:

1. **Searches** Wikimedia Commons and Openverse for openly licensed images. It tries phrasings that favor single objects, such as "… transparent background", "… standing transparent background" and "… silhouette". If nothing usable turns up, it falls back to the general subject ("knight" → "person").
2. **Downloads and analyzes** up to 10 candidates per phrasing, then picks the cleanest *relevant* one. Rejected:
   - maps, logos and diagrams;
   - framed scene photos;
   - cropped objects;
   - pictures with two objects in them;
   - wrong proportions (a standing person must be clearly taller than wide, a rifle long and thin, and four-legged animals can't fill their bounding box).
3. **Inflates** the silhouette into a rounded 3D body. Thickness follows the local width, so arms and barrels stay thin while a torso is full, and flat objects like rifles and guitars are kept slim. The reference's colors are painted on, and the model is scaled to real-world size (a person is 1.75 m tall, a rifle 1.1 m long).

Your text still takes priority: color, material and style words override the reference. The result shows the reference image with its title, author and license; CC licenses require you to credit it if you publish the asset. **Disliking** a result makes future generations of that prompt skip its reference image, and **liking** one makes it the first choice.

Only these image hosts are ever contacted: `upload.wikimedia.org`, `thumb.wikimedia.org` and `api.openverse.org`. Search results and downloaded images are cached under `server/storage/references/`. `REFERENCES=off` disables the search.

### Feedback: "Do you like this result?"

Every result has **Yes / No** buttons. After a **No** you can say what should change, then press **Try again**.

- Ratings are stored with the full design that was generated, so they still count after a temporary asset expires.
- The next time anyone generates something similar, the most relevant ratings are retrieved. **Your own ratings count 3× as much as other people's**, and older ratings fade over time.
- **Liked designs** are shown to the model as examples to follow.
- **Disliked designs**, with your reason, are described to the model as things to fix.
- **Without the model:** a liked design for a near-identical prompt is reused, and repeated dislikes switch to a different variation.

### How images are interpreted

Photos and video frames are **modeled, not pasted on as textures**. Each image is analyzed locally:

1. **Separate the object from the background.** The background is flood-filled in from the image border, or taken from the alpha channel of a transparent PNG. Enclosed background-colored pockets become openings, and detached parts are kept.
2. **Measure the silhouette:** the best vertical symmetry axis, proportions, how boxy or round it is, its outline and its holes.
3. **Read the colors.** A shade-tolerant palette is built, so lit and shadowed areas of one material stay one color. From that come color bands (top to bottom) and color regions.
4. **Infer a form.** The image's palette paints the result, and the material is guessed from color and texture.

   | Looks like | Becomes |
   | --- | --- |
   | Symmetric (vase, bottle, apple, lamp) | Profile **revolved** into a round 3D shape with color bands |
   | Symmetric body + extra parts (mug + handle) | **Revolved** body with the parts **extruded** and attached |
   | Boxy | **Box** with the image's proportions |
   | People, animals, anything limbed or irregular | Silhouette **inflated** into a rounded body with painted color regions |
   | Anything, when the text says "flat" or "cutout" | Outline **extruded** into a flat solid |

With several images (or video frames), the one with the clearest outline is used. The result lists how each decision was made.

**Limitation:** an object that is nearly the same color as its background (e.g. cream on off-white) can't be separated from it reliably.

### Text takes priority over the image

When you combine text with a photo or video, anything the text specifies overrides the image. The image fills in only what the text leaves out.

- **With the text model:** if the text names an object, the model designs it, and the image's colors and proportions are passed along as hints. If the text only describes a style ("rusty metal, wide"), the shape comes from the image.
- **Without it,** these keywords apply:
- **Shapes:** crate, barrel, orb, cone, tree, rock, pillar, coin, gem, mushroom, house, sword, potion, star, heart. A text shape replaces the image's outline, and the image then supplies colors and proportions.
- **Colors:** red, gold, blue, … The first color replaces the image's main color. A second color becomes the accent (trim, cork, handle…).
- **Materials:** wood, stone, metal, brick, glass. A material word that is really the accent color ("green potion with gold cork") only colors that part.
- **Proportions:** tall/short, wide/slim, flat/thick
- **Styles:** low poly, smooth, shiny, matte, glowing (emissive), rusty, mossy, pixel (2D)
- **Sizes:** tiny, small, large, huge

## Project layout

```
shared/   Format + engine compatibility matrix and API types (used by both sides)
server/   Express API: auth, uploads, generation, exporters, SQLite (node:sqlite)
client/   React + Vite UI
```

## Adding a real AI backend

1. Implement `AssetGenerator` from [server/src/generators/types.ts](server/src/generators/types.ts). It returns `MeshData` (meters, Y-up, pivot at the bottom) or RGBA `SpriteData`.
2. Register it in [server/src/generators/index.ts](server/src/generators/index.ts).
3. Set `GENERATOR=<id>`.

The exporters, previews and library work unchanged.

## Notes

- FBX is written as **ASCII** FBX 7.4. Unity, Unreal and Godot read it; Roblox works best with binary FBX, so the UI recommends OBJ or GLB for Roblox.
- Unity needs the glTFast package to import GLB/glTF.
