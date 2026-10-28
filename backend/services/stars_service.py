import asyncio
import json
import logging
import math
import random
import time
from logging import Logger
from pathlib import Path
from typing import cast

import httpx
import numpy as np
from models.dtos.sky_response import SkyResponse
from models.dtos.star import Star
from numpy.typing import NDArray
from utils import healpy_typed as hp

logger: Logger = logging.getLogger()

# CDS serves Gaia DR3 as HiPS catalog tiles: plain TSV, sorted brightest-first.
# The sky has 12 base tiles; each splits into 4 per order (level of detail).
GAIA_HIPS: str = "https://hipscat.cds.unistra.fr/HiPSCatService/I/355/gaiadr3"
MAX_ORDER: int = 4

# A "location" is one of the 48 order-1 tiles; the view points at its centre
TILE_ORDER: int = 1
TILE_COUNT: int = hp.nside2npix(1 << TILE_ORDER)

# Fetched tile sets are kept in memory and on disk. Gaia DR3 is a fixed release,
# so a long TTL is safe; it mostly guards against a bad fetch living forever.
CACHE_DIR: Path = Path(__file__).resolve().parent.parent / "cache" / "stars"
CACHE_TTL: float = 7 * 24 * 60 * 60  # seconds
_stars_cache: dict[str, tuple[float, list[Star]]] = {}  # key -> (fetched at, stars)
# Be polite to CDS: at most this many tile requests in flight
_upstream: asyncio.Semaphore = asyncio.Semaphore(32)


async def fetch_tile(client: httpx.AsyncClient, order: int, pixel: int) -> list[Star]:
    """Fetch one HiPS tile and keep only the columns the renderer needs"""
    url: str = f"{GAIA_HIPS}/Norder{order}/Dir{(pixel // 10000) * 10000}/Npix{pixel}.tsv"
    async with _upstream:
        response: httpx.Response = await client.get(url)
    _ = response.raise_for_status()

    lines: list[str] = [line for line in response.text.splitlines() if not line.startswith("#")]
    header: list[str] = lines[0].split("\t")
    col: dict[str, int] = {name: i for i, name in enumerate(header)}

    stars: list[Star] = []
    for line in lines[1:]:
        row: list[str] = line.split("\t")
        hip: str = row[col["HIP"]]
        stars.append({
            "ra": float(row[col["RAdeg"]]),
            "dec": float(row[col["DEdeg"]]),
            "mag": float(row[col["Gmag"]]),
            "hip": int(hip) if hip else None,
        })
    return stars


def tile_center(pixel: int) -> tuple[float, float]:
    """RA/Dec of an order-1 tile's centre, degrees"""
    return hp.pix2ang(1 << TILE_ORDER, pixel)


def diamond_tiles(pixel: int) -> list[tuple[int, int]]:
    """An order-1 tile and everything nested under it: one diamond of sky"""
    return [
        (order, child)
        for order in range(TILE_ORDER, MAX_ORDER + 1)
        for child in range(pixel << (2 * (order - TILE_ORDER)), (pixel + 1) << (2 * (order - TILE_ORDER)))
    ]


def disc_tiles(center: tuple[float, float], radius: float) -> list[tuple[int, int]]:
    """Every tile overlapping a disc of the given radius around a centre"""
    vec: NDArray[np.float64] = hp.ang2vec(*center)
    return [
        (order, pixel)
        for order in range(TILE_ORDER, MAX_ORDER + 1)
        for pixel in hp.query_disc(1 << order, vec, math.radians(radius))
    ]


def within_disc(stars: list[Star], center: tuple[float, float], radius: float) -> list[Star]:
    """Trim the ragged tile edges back to the disc itself"""
    if not stars:
        return stars
    vec: NDArray[np.float64] = hp.ang2vec(*center)
    vectors: NDArray[np.float64] = hp.ang2vec([s["ra"] for s in stars], [s["dec"] for s in stars])
    inside = cast(list[bool], (vectors @ vec >= math.cos(math.radians(radius))).tolist())
    return [star for star, keep in zip(stars, inside, strict=True) if keep]


def cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def load_cached(key: str) -> list[Star] | None:
    """Memory first, then disk; None if missing or older than the TTL"""
    if key in _stars_cache:
        fetched_at, stars = _stars_cache[key]
        if time.time() - fetched_at < CACHE_TTL:
            return stars
        del _stars_cache[key]

    path: Path = cache_path(key)
    if not path.exists():
        return None
    fetched_at = path.stat().st_mtime
    if time.time() - fetched_at >= CACHE_TTL:
        return None
    try:
        stars = cast(list[Star], json.loads(path.read_text()))
    except (OSError, ValueError):
        logger.warning("Unreadable cache file %s; refetching", path)
        return None
    _stars_cache[key] = (fetched_at, stars)
    return stars


def store_cached(key: str, stars: list[Star]) -> None:
    now: float = time.time()
    _stars_cache[key] = (now, stars)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path: Path = cache_path(key)
    # Write beside then rename, so a crash mid-write never leaves a half file
    tmp: Path = path.with_suffix(".json.tmp")
    _ = tmp.write_text(json.dumps(stars, separators=(",", ":")))
    _ = tmp.replace(path)


async def stars_for(pixel: int, radius: float | None) -> SkyResponse:
    """The stars of one tile: its own diamond, or a disc of the given radius around its centre"""
    center: tuple[float, float] = tile_center(pixel)
    key: str = f"tile{pixel}" if radius is None else f"tile{pixel}-disc{radius:g}"
    stars: list[Star] | None = load_cached(key)
    if stars is None:
        tiles: list[tuple[int, int]] = diamond_tiles(pixel) if radius is None else disc_tiles(center, radius)
        async with httpx.AsyncClient(timeout=60) as client:
            results: list[list[Star]] = await asyncio.gather(
                *(fetch_tile(client, order, child) for order, child in tiles)
            )
        stars = [star for tile in results for star in tile]
        if radius is not None:
            stars = within_disc(stars, center, radius)
        logger.info("Fetched %d stars from %d tiles for %s", len(stars), len(tiles), key)
        store_cached(key, stars)
    return {
        "pixel": pixel,
        "tiles": TILE_COUNT,
        "center": {"ra": center[0], "dec": center[1]},
        "stars": stars,
    }


async def random_stars(avoid: int | None, radius: float | None) -> SkyResponse:
    """Any tile but the one to avoid"""
    choices: list[int] = [p for p in range(TILE_COUNT) if p != avoid]
    return await stars_for(random.choice(choices), radius)
