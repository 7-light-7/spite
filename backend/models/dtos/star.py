from typing import TypedDict


class Star(TypedDict):
    ra: float
    dec: float
    mag: float
    hip: int | None
