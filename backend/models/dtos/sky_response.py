from typing import TypedDict

from models.dtos.star import Star


class SkyResponse(TypedDict):
    pixel: int
    tiles: int
    center: dict[str, float]
    stars: list[Star]
