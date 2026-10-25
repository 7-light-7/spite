# spite
<img width="1917" height="995" alt="image" src="https://github.com/user-attachments/assets/a0fa71a7-58c9-4205-ab1c-24c211db0385" />
My personal site, is a patch of the real night sky: thousands of Gaia stars, twinkling, at scale.

## The idea
The backend serves star catalog data for a region of sky; the frontend draws it.

Stars come from [Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3), 1.8 billion of them, which CDS in Strasbourg serves as [HiPS](https://aladin.cds.unistra.fr/hips/) catalog tiles: the sky split into 12 base tiles, each splitting into 4 per level of detail, with the brightest stars at the coarse levels. Nobody ever downloads the whole catalog; only the tiles for the region being looked at, down to level 4.

The home page shows one region at a time. The view is a stereographic projection (Stellarium's default) centred on a tile, drawn so that ~42° of sky fits the short edge of the window. Stars are dots sized by magnitude, each with its own slow flicker. There's no zoom: the full-screen view just fetches more sky around the same centre, cropped at the screen edges, so what you see is an accurate model of that section of space at that view angle.

Done so far:

- Gaia stars rendered as twinkling dots, sized and dimmed by magnitude
- Full-screen view (default) and tile-only "diamond" view, toggled by clicking `spite`
- `go somewhere else`: jumps to a random one of the 48 level-1 tiles
- System light/dark theme. Dark is the night sky; light is Solarized, with faint stars in violet so they survive on paper. The canvas reads the CSS theme every frame, so a theme switch crossfades everything, stars included
- Footer: where on Earth the view centre is straight overhead right now (it moves west 15° an hour), the centre's RA/Dec, and how many degrees of sky are on screen
- A live UTC clock

Ideas, in no particular order:

- Hover a star to see its name (needs the IAU named-stars list mapped onto Hipparcos ids, which Gaia carries as `HIP`)
- Constellation name for the view centre: `astropy`'s `SkyCoord.get_constellation()` does it offline and is already installed
- Star colour from Gaia's `BP-RP` index
- The Sun, Moon and planets, computed with [skyfield](https://rhodesmill.org/skyfield/)
- A visitor's own sky, from their IP

The bar to clear is the existing sky-chart sites, which are accurate but static. Same accuracy, but alive.

## Layout

```
backend/            FastAPI (Python, .venv at the repo root)
  main.py           app factory and lifespan
  routes/           endpoints only; validation lives in the Query params
  services/         stars_service.py: CDS client, HEALPix tile maths, cache
  cache/stars/      fetched tile sets as JSON (gitignored)
frontend/           Vite + React + TypeScript, strict mode
  src/App.tsx       projection, canvas renderer, controls
  src/index.css     theme tokens and layout
```

## API

`GET /stars?pixel=N&radius=R`
: Stars for level-1 tile `N` (0–47). Without `radius`, the tile itself and everything nested under it, down to level 4 (~4,000 stars, a diamond of sky). With `radius` (degrees, ≤ 90), a disc of that radius around the tile's centre, trimmed to the disc (50° is ~37,000 stars).

`GET /stars/random?avoid=N&radius=R`
: Same, for a random tile other than `N`.

Both return:

```json
{
  "pixel": 0,
  "tiles": 48,
  "center": { "ra": 45.0, "dec": 19.47 },
  "stars": [ { "ra": 44.93, "dec": 8.91, "mag": 4.66, "hip": 13954 } ]
}
```

`ra`/`dec` in degrees, `mag` is Gaia G magnitude (smaller is brighter), `hip` is the Hipparcos id or `null`.

Every tile set is cached in memory and on disk under `backend/cache/stars/`, keyed by tile and radius, with a 7-day TTL (Gaia DR3 is a fixed release, so the TTL only guards against a bad fetch). A cold fetch of a 50° disc is ~20 s for ~700 upstream tiles, at most 32 in flight at once; after that it's milliseconds, across restarts. Tiles are written to a temp file and renamed, so a crash mid-write never leaves a half file.

## Running it

### Containers

```sh
podman compose up --build
```

Then open http://localhost:8080. Two containers: the backend (Python, from `backend/requirements.txt`) and the frontend (a Vite build served by nginx, which also proxies `/api/` to the backend and gzips the star JSON). Fetched tiles live in the `stars-cache` volume, so they survive restarts and rebuilds. `docker compose` works the same way.

`podman compose` needs the podman API socket: `systemctl --user start podman.socket` (or `enable --now` to keep it).

### For development

Backend deps are in `backend/requirements.txt` (`healpy` brings `numpy` and `astropy`).

Two terminals.

```sh
# backend, from backend/
../.venv/bin/uvicorn main:app --reload --port 8000

# frontend, from frontend/
npm run dev
```

The Vite dev server proxies `/api/*` to the backend on port 8000 and strips the prefix, so `fetch('/api/stars')` reaches the backend's `/stars`. Backend routes don't need an `/api` prefix.

`#diamond` in the URL opens the tile-only view.

Star data: ESA/Gaia/DPAC, served by CDS, Strasbourg.
