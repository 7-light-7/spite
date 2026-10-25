from logging import Logger
from fastapi import APIRouter, Query
import logging
from services.stars_service import TILE_COUNT, SkyResponse, random_stars, stars_for

logger: Logger = logging.getLogger()
router: APIRouter = APIRouter()

RadiusParam = Query(None, gt=0, le=90, description="Disc radius in degrees; omit for the tile's own diamond")


@router.get("/healthz")
def get_health()-> dict[str,str]:
    return {
        'status': 'ok'
    }


@router.get("/stars")
async def get_stars(
    pixel: int = Query(0, ge=0, lt=TILE_COUNT, description="Which of the 48 order-1 tiles to look at"),
    radius: float | None = RadiusParam,
) -> SkyResponse:
    return await stars_for(pixel, radius)


@router.get("/stars/random")
async def get_random_stars(
    avoid: int | None = Query(None, ge=0, lt=TILE_COUNT, description="A tile not to pick, e.g. the current one"),
    radius: float | None = RadiusParam,
) -> SkyResponse:
    return await random_stars(avoid, radius)
