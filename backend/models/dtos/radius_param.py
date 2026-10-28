from typing import Annotated

from fastapi import Query

RadiusParam = Annotated[
    float | None,
    Query(gt=0, le=90, description="Disc radius in degrees; omit for the tile's own diamond"
    ),
]