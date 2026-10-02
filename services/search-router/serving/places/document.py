"""PlaceDocumentV1 — frozen serving-projection contract (P16 → P17 boundary).

This module is the single boundary between the canonical entity/place graph
(P16, ``resolution/`` + migrations 010/011) and the serving layer (P17:
OpenSearch place index, PostGIS geo path, Redis caches, local retrieval,
fusion/ranking, ``/v1/places/*``).

Rules:

- Serving/indexing code consumes ``PlaceDocumentV1`` only. It must not
  import resolver internals (``resolution.match``, ``resolution.normalize``,
  ``resolution.provenance``) or couple to P16 module structure.
- Canonical graph changes stay behind the projection: if P16.x adds
  canonical fields, they surface here via a NEW document version
  (``PlaceDocumentV2``), never by silently mutating V1 semantics.
- Field provenance/explainability stays in the canonical DB
  (``place_field_provenance``); this document carries only the resolved
  serving view.

Column mapping (canonical_places → document):

- ``place_id`` / ``business_id`` / ``admin_unit_id``: BIGINTs stringified
  for index-key stability.
- ``name`` ← ``canonical_name``; ``category_ids`` ← ``[canonical_category]``
  (list-typed for future multi-category); ``phone`` ← ``[phone]`` filtered.
- ``aliases``: distinct name variants observed across ``place_sources``;
  may be empty.
- ``freshness_score``: derived at projection time (not stored canonical) —
  recency decay over ``last_seen`` / provenance ``observed_at``.
- ``last_verified_at`` ← ``verified_at`` (P-DATA-1A): set only when the
  canonical row actually earned ``verification_level >= corroborated``.
  ``last_seen`` surfaces separately — it is a sighting timestamp, never
  a verification claim.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

PLACE_DOCUMENT_VERSION = 1
PLACE_DOCUMENT_VERSION_V2 = 2  # current produced version (P-DATA-1A)

# Canonical operational status values (P16.1 — normalized from provider
# vocabularies at resolution time; see resolution/normalize.py).
STATUS_OPEN = "open"
STATUS_TEMPORARILY_CLOSED = "temporarily_closed"
STATUS_PERMANENTLY_CLOSED = "permanently_closed"
STATUS_UNKNOWN = "unknown"
PLACE_STATUSES = frozenset(
    {
        STATUS_OPEN,
        STATUS_TEMPORARILY_CLOSED,
        STATUS_PERMANENTLY_CLOSED,
        STATUS_UNKNOWN,
    }
)


@dataclass(slots=True)
class PlaceDocumentV1:
    """Flattened read model for one canonical place.

    Produced by the serving projection from ``canonical_places`` (+ its
    ``place_sources`` lineage); consumed by the OpenSearch indexer, PostGIS
    retrieval, Redis caches, and the ``/v1/places/*`` response mapper.
    """

    place_id: str
    business_id: str | None

    name: str
    aliases: list[str] = field(default_factory=list)
    normalized_name: str = ""

    category_ids: list[str] = field(default_factory=list)

    # NULL-able: staged sources may lack coordinates; geo lanes must
    # tolerate absence rather than fabricate a position.
    lat: float | None = None
    lon: float | None = None
    admin_unit_id: str | None = None

    status: str = STATUS_UNKNOWN  # one of PLACE_STATUSES
    confidence: float = 0.0  # canonical resolution confidence, 0..1
    freshness_score: float = 0.0  # projection-derived recency, 0..1

    address: str | None = None
    phone: list[str] = field(default_factory=list)
    website: str | None = None
    website_domain: str | None = None

    opening_hours: dict[str, Any] | None = None

    # P2.0 rich-card fields — promoted from source raw_payload at
    # resolution time; None when no contributing record reported them.
    rating: float | None = None
    review_count: int | None = None
    price_level: str | None = None
    primary_image_url: str | None = None
    images: list[str] = field(default_factory=list)
    # Derived at serve time (never stored): open_now resolves
    # opening_hours against UTC+7; map_url is the Google Maps link.
    open_now: bool | None = None
    map_url: str | None = None

    source_count: int = 0  # distinct providers contributing
    last_verified_at: datetime | None = None

    @property
    def document_version(self) -> int:
        return PLACE_DOCUMENT_VERSION

    def to_dict(self) -> dict[str, Any]:
        """JSON-ready dict for index payloads and cache values."""
        data = asdict(self)
        data["document_version"] = PLACE_DOCUMENT_VERSION
        if self.last_verified_at is not None:
            data["last_verified_at"] = self.last_verified_at.isoformat()
        return data


@dataclass(slots=True)
class PlaceDocumentV2(PlaceDocumentV1):
    """V1 + honest verification state (P-DATA-1A).

    Canonical ``verified_at`` / ``verification_level`` /
    ``verification_method`` surfaced per the V1 contract's versioning
    rule: new canonical fields arrive as a new document version, not a
    silent V1 mutation. ``last_seen`` is exposed as its own field so the
    observation timestamp is no longer overloaded as verification.

    Old V1 index sources deserialize into V2 with observed defaults —
    they lose the inflated ``last_verified_at`` alias at read time, which
    is exactly the point of the hardening.
    """

    last_seen: datetime | None = None
    verification_level: str = "observed"  # observed|corroborated|verified|authoritative
    verification_method: str | None = None

    @property
    def document_version(self) -> int:
        return PLACE_DOCUMENT_VERSION_V2

    def to_dict(self) -> dict[str, Any]:
        # Explicit base call — zero-arg super() breaks under slots=True
        # dataclass inheritance (the __class__ cell binds pre-slots).
        data = PlaceDocumentV1.to_dict(self)
        data["document_version"] = PLACE_DOCUMENT_VERSION_V2
        if self.last_seen is not None:
            data["last_seen"] = self.last_seen.isoformat()
        return data
