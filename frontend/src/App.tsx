import { useEffect, useRef, useState } from 'react'

// Shape of one star from GET /stars
interface Star {
  ra: number // right ascension, degrees
  dec: number // declination, degrees
  mag: number // apparent magnitude: smaller is brighter
  hip: number | null // Hipparcos id, when the star has one
}

interface SkyResponse {
  pixel: number // which of the sky's order-1 tiles this is
  tiles: number // how many there are
  center: { ra: number; dec: number } // where the view points
  stars: Star[]
}

// A star projected onto the view plane, with its own twinkle rhythm
interface PlacedStar {
  x: number // projected units, east negative (sky is seen from inside)
  y: number // projected units, north positive
  radius: number
  brightness: number // 0 (faintest) .. 1 (brightest); the theme decides what opacity that maps to
  phase: number
  speed: number
}

interface View {
  pixel: number
  tiles: number
  center: { ra: number; dec: number }
  stars: PlacedStar[]
}

// A tile's diamond is ~42 degrees across; it's fitted to 92% of the short screen edge.
// Everything else is drawn at that same scale, so wide mode is more sky, not a zoom.
const FIELD_HALF_SPAN = 2 * Math.tan(((42 / 2) * Math.PI) / 360) // stereographic units
const FIELD_FILL = 0.92
const BRIGHTEST_MAG = 2
const FAINTEST_MAG = 10
const FAINT_RADIUS = 1 // dots smaller than this are drawn in the theme's faint-star colour
const MAX_RADIUS = 60

const rad = (deg: number) => (deg * Math.PI) / 180

function radiusFor(mag: number): number {
  // Each magnitude step is ~2.5x dimmer; shrink the dot gently with that
  return Math.max(0.35, 3.2 * Math.pow(10, -0.18 * (mag - BRIGHTEST_MAG)))
}

function brightnessFor(mag: number): number {
  return Math.min(1, Math.max(0, (FAINTEST_MAG - mag) / (FAINTEST_MAG - BRIGHTEST_MAG)))
}

// Pixels per projected unit for a given screen
function scaleFor(width: number, height: number): number {
  return (FIELD_FILL * Math.min(width, height)) / (2 * FIELD_HALF_SPAN)
}

// How many degrees of sky around the centre are needed to reach the screen corners
function radiusToCover(width: number, height: number): number {
  const halfDiagonal = Math.hypot(width, height) / 2 / scaleFor(width, height)
  const degrees = (2 * Math.atan(halfDiagonal / 2) * 180) / Math.PI
  return Math.min(MAX_RADIUS, Math.ceil((degrees + 1) / 10) * 10) // coarse steps: each is a separate fetch
}

// Stereographic projection about the view centre: angles near the centre map 1:1 (in radians)
function place(stars: Star[], center: { ra: number; dec: number }): PlacedStar[] {
  const dec0 = rad(center.dec)
  const sinDec0 = Math.sin(dec0)
  const cosDec0 = Math.cos(dec0)

  const placed = stars.map((s) => {
    const dec = rad(s.dec)
    const dRa = rad(s.ra - center.ra)
    const sinDec = Math.sin(dec)
    const cosDec = Math.cos(dec)
    const k = 2 / (1 + sinDec0 * sinDec + cosDec0 * cosDec * Math.cos(dRa))
    return {
      x: -k * cosDec * Math.sin(dRa), // east is to the left when looking up
      y: k * (cosDec0 * sinDec - sinDec0 * cosDec * Math.cos(dRa)),
      radius: radiusFor(s.mag),
      brightness: brightnessFor(s.mag),
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 1.2, // radians per second
    }
  })
  // Brightest first, so the renderer switches colour once rather than per star
  return placed.sort((a, b) => b.radius - a.radius)
}

function Sky({ stars }: { stars: PlacedStar[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    const dpr = window.devicePixelRatio || 1

    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
    }
    resize()
    window.addEventListener('resize', resize)

    const rootStyle = getComputedStyle(document.documentElement)

    const draw = (now: number) => {
      const t = now / 1000
      const w = canvas.width
      const h = canvas.height
      const scale = scaleFor(w, h)
      const cx = w / 2
      const cy = h / 2

      // Colours come from the CSS theme, read each frame so a theme change crossfades with the page
      const ink = rootStyle.getPropertyValue('--ink')
      const faintInk = rootStyle.getPropertyValue('--star-faint')
      const floor = parseFloat(rootStyle.getPropertyValue('--star-floor')) || 0.3
      ctx.fillStyle = rootStyle.getPropertyValue('--bg')
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = ink
      let onFaint = false

      for (const s of stars) {
        const x = cx + s.x * scale
        const y = cy - s.y * scale
        if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue

        if (!onFaint && s.radius < FAINT_RADIUS) {
          ctx.fillStyle = faintInk // stars are sorted bright-first, so this happens once
          onFaint = true
        }

        // Two overlaid sine waves so the flicker doesn't look metronomic
        const twinkle =
          1 + 0.3 * (0.6 * Math.sin(t * s.speed + s.phase) + 0.4 * Math.sin(t * s.speed * 2.7 + s.phase * 1.3))
        const r = s.radius * dpr * twinkle
        ctx.globalAlpha = Math.min(1, (floor + (1 - floor) * s.brightness) * twinkle)

        if (r < 0.7) {
          // Sub-pixel stars: a square is indistinguishable and far cheaper than an arc
          ctx.fillRect(x - r, y - r, r * 2, r * 2)
          continue
        }
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()

        // Soft halo on the bright ones
        if (s.radius > 1.6) {
          ctx.globalAlpha = 0.08 * twinkle
          ctx.beginPath()
          ctx.arc(x, y, r * 3.5, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [stars])

  return <canvas ref={canvasRef} />
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 250)
    return () => clearInterval(tick)
  }, [])
  return now
}

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return size
}

function Clock({ now }: { now: Date }) {
  return (
    <time className="clock" dateTime={now.toISOString()}>
      {now.toISOString().slice(0, 19).replace('T', ' ')} UTC
    </time>
  )
}

// Greenwich mean sidereal time in degrees: how far the sky has turned past Greenwich
function siderealTime(date: Date): number {
  const daysSinceJ2000 = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86_400_000
  return (((280.46061837 + 360.98564736629 * daysSinceJ2000) % 360) + 360) % 360
}

function formatLatLon(lat: number, lon: number): string {
  const lonSigned = ((lon + 540) % 360) - 180 // wrap into -180..180
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lonSigned).toFixed(1)}°${lonSigned >= 0 ? 'E' : 'W'}`
}

function formatRaDec(center: { ra: number; dec: number }): string {
  const hours = center.ra / 15
  const h = Math.floor(hours)
  const m = String(Math.round((hours - h) * 60)).padStart(2, '0')
  const sign = center.dec >= 0 ? '+' : '−'
  return `RA ${h}h${m}m Dec ${sign}${Math.abs(center.dec).toFixed(1)}°`
}

function ViewInfo({ view, now }: { view: View; now: Date }) {
  const { width, height } = useWindowSize()
  // The view centre is straight overhead where local sidereal time equals its RA
  const overheadLon = view.center.ra - siderealTime(now)
  const acrossUnits = width / scaleFor(width, height)
  const acrossDeg = (4 * Math.atan(acrossUnits / 4) * 180) / Math.PI

  return (
    <p className="view">
      looking straight up from {formatLatLon(view.center.dec, overheadLon)}
      <br />
      tile {view.pixel + 1}/{view.tiles} · {formatRaDec(view.center)} · {Math.round(acrossDeg)}° of sky across
    </p>
  )
}

export default function App() {
  const now = useNow()
  const [wide, setWide] = useState(() => window.location.hash !== '#diamond')
  const [radius, setRadius] = useState<number | null>(null) // null: the tile's own diamond
  const [view, setView] = useState<View | null>(null)
  // What's loading decides where the indicator shows: under the title, or on the button that was clicked
  const [loading, setLoading] = useState<'none' | 'sky' | 'elsewhere'>('sky')
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  // Wide mode asks for whatever radius this screen needs; refetch if it grows on resize
  useEffect(() => {
    window.location.hash = wide ? '' : 'diamond'
    if (!wide) {
      setRadius(null)
      return
    }
    const update = () => setRadius((r) => Math.max(r ?? 0, radiusToCover(window.innerWidth, window.innerHeight)))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [wide])

  // The current view stays up until the new one has fully arrived; late responses are dropped
  const load = (path: string, kind: 'sky' | 'elsewhere') => {
    const id = ++latestRequest.current
    setLoading(kind)
    setError(null)
    fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json() as Promise<SkyResponse>
      })
      .then((data) => {
        if (id !== latestRequest.current) return
        setView({ pixel: data.pixel, tiles: data.tiles, center: data.center, stars: place(data.stars, data.center) })
      })
      .catch((err: unknown) => {
        if (id === latestRequest.current) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (id === latestRequest.current) setLoading('none')
      })
  }

  const radiusQuery = radius === null ? '' : `&radius=${radius}`

  // Refetch the current tile whenever the radius changes (and once on mount)
  const pixel = view?.pixel ?? 0
  useEffect(() => {
    load(`/api/stars?pixel=${pixel}${radiusQuery}`, 'sky')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusQuery])

  const goElsewhere = () => load(`/api/stars/random?avoid=${pixel}${radiusQuery}`, 'elsewhere')

  return (
    <>
      <button
        type="button"
        className="title"
        aria-pressed={wide}
        title={wide ? 'Show just the tile' : 'Fill the screen'}
        onClick={() => setWide((w) => !w)}
      >
        spite
      </button>
      <button type="button" className="elsewhere" disabled={loading !== 'none'} onClick={goElsewhere}>
        {loading === 'elsewhere' ? 'loading…' : 'go somewhere else'}
      </button>
      {error && <p className="status">Couldn't load the sky: {error}</p>}
      {!error && loading === 'sky' && <p className="status">{view ? 'Loading more sky…' : 'Loading the sky…'}</p>}
      {view && <Sky stars={view.stars} />}
      {view && <ViewInfo view={view} now={now} />}
      <Clock now={now} />
    </>
  )
}
