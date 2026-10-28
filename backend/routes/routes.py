import logging
from logging import Logger
from typing import Annotated

from fastapi import APIRouter, Query
from models.dtos.radius_param import RadiusParam
from models.dtos.sky_response import SkyResponse
from services.stars_service import TILE_COUNT, random_stars, stars_for

logger: Logger = logging.getLogger()
router: APIRouter = APIRouter()


@router.get("/healthz")
def get_health()-> dict[str, str]:
    """Simple Health Check"""
    return {
        "status": "ok"
    }


@router.get("/stars")
async def get_stars(pixel: Annotated[int, Query(ge=0, lt=TILE_COUNT, description="Which of the 48 order-1 tiles to look at")] = 0,
    radius: RadiusParam = None) -> SkyResponse:
    """Main Star Call"""

    return await stars_for(pixel, radius)


@router.get("/stars/random")
async def get_random_stars(avoid: Annotated[int | None, Query(ge=0, lt=TILE_COUNT, description="A tile not to pick, e.g. the current one")] = None,
    radius: RadiusParam = None) -> SkyResponse:
    """Jump to Random location """
    return await random_stars(avoid, radius)
