"""POST /v1/retrieve — one retrieval brain for UI, API and MCP facades."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from core.unified_retrieve import UnifiedRetriever
from security.apikeys import require_api_key

router = APIRouter(
    prefix="/v1", tags=["retrieve"], dependencies=[Depends(require_api_key)]
)


class UserLocation(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RetrieveRequest(BaseModel):
    contract_version: Literal["1"] = "1"
    query: str = Field(min_length=1, max_length=500)
    context: str | None = Field(default=None, max_length=500)
    mode: Literal["auto", "fast", "standard", "balanced", "research", "deep"] = "auto"
    location: UserLocation | None = None
    max_results: int = Field(default=10, ge=1, le=30)
    evidence: Literal["auto", "off", "full"] = "auto"
    record: bool = True

    @field_validator("query")
    @classmethod
    def not_blank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("query must not be blank")
        return value


def retrieval_service():
    return UnifiedRetriever()


RetrievalService = Annotated[UnifiedRetriever, Depends(retrieval_service)]


@router.post("/retrieve")
async def retrieve(req: RetrieveRequest, service: RetrievalService):
    return await service.retrieve(req.model_dump())
