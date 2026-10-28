"""Typed wrappers around healpy, which ships no type info.

Each call is suppressed once here, so Unknown types don't spread into callers.
"""

from typing import cast

import healpy as hp
import numpy as np
from numpy.typing import NDArray


def nside2npix(nside: int) -> int:
    return hp.nside2npix(nside)  # pyright: ignore[reportUnknownMemberType]


def pix2ang(nside: int, pixel: int) -> tuple[float, float]:
    """RA/Dec of a nested pixel's centre, degrees"""
    ra, dec = cast(tuple[float, float], hp.pix2ang(nside, pixel, nest=True, lonlat=True))  # pyright: ignore[reportUnknownMemberType]
    return float(ra), float(dec)


def ang2vec(ra: float | list[float], dec: float | list[float]) -> NDArray[np.float64]:
    """Unit vector(s) for RA/Dec in degrees"""
    return hp.ang2vec(ra, dec, lonlat=True)  # pyright: ignore[reportUnknownMemberType]


def query_disc(nside: int, vec: NDArray[np.float64], radius: float) -> list[int]:
    """Nested pixels overlapping a disc; radius in radians"""
    pixels = cast(NDArray[np.int64], hp.query_disc(nside, vec, radius, inclusive=True, nest=True))  # pyright: ignore[reportUnknownMemberType]
    return cast(list[int], pixels.tolist())
