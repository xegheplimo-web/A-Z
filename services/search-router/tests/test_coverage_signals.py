"""P-LEARNING-3 — coverage cell derivation from retrieval results.

Pure-function tests: no DB needed. record_coverage() itself is exercised
against the live stack (pool None → graceful skip).
"""

from datetime import date

from core.coverage import coverage_cell, iso_week


def _result(
    intent="local_search",
    exact=0,
    unverified=0,
    docs=0,
    communes=(),
    provinces=(),
    resolved=(),
    locations=(),
    specialty="nhà thuốc",
):
    return {
        "understanding": {
            "intent": intent,
            "specialty": specialty,
            "resolved_current_ids": list(resolved),
            "locations": [{"id": loc, "name": loc, "type": "x", "status": "current"} for loc in locations],
        },
        "places": {
            "exact": [{}] * exact,
            "unverified": [{}] * unverified,
            "related": [],
        },
        "docs": [{}] * docs,
        "scope": {"communes": list(communes), "provinces": list(provinces)},
    }


def test_local_zero_result_marks_gap():
    cell = coverage_cell(_result(communes=["new:07681"]), today=date(2026, 3, 30))
    assert cell is not None
    assert cell["cell_key"] == "new:07681|nhà thuốc|2026-W14"
    assert cell["zero_result"] == 1 and cell["low_result"] == 1
    assert cell["admin_id"] == "new:07681"


def test_cell_prefers_commune_over_resolver_first_element():
    # resolved_current_ids order must not decide the cell — scope.communes wins
    cell = coverage_cell(
        _result(communes=["new:07681"], provinces=["new:07210"], resolved=["new:07210"]),
        today=date(2026, 3, 30),
    )
    assert cell["admin_id"] == "new:07681"


def test_same_code_successor_wins_among_many_communes():
    # "Neo" resolves old:07681 (TT Nham Biền, historical) whose successor list
    # contains 6 phường — the demand cell must be the direct rename
    # new:07681 (Phường Yên Dũng), not successor-list order.
    cell = coverage_cell(
        _result(
            communes=["new:07210", "new:07738", "new:07681"],
            resolved=["new:07210", "new:07738", "new:07681"],
            locations=["old:07681"],
        )
    )
    assert cell["admin_id"] == "new:07681"


def test_cell_falls_back_to_province_then_resolved():
    assert coverage_cell(_result(provinces=["new:07210"]))["admin_id"] == "new:07210"
    assert coverage_cell(_result(resolved=["x_abc"]))["admin_id"] == "x_abc"


def test_exact_results_are_not_zero_or_low():
    cell = coverage_cell(_result(exact=3, communes=["new:07681"]), today=date(2026, 3, 30))
    assert cell["zero_result"] == 0 and cell["low_result"] == 0


def test_unverified_still_counts_as_gap_and_low():
    cell = coverage_cell(_result(unverified=2, communes=["new:07681"]))
    assert cell["zero_result"] == 1 and cell["low_result"] == 1


def test_local_without_anchor_or_specialty_is_skipped():
    assert coverage_cell(_result(specialty=None)) is None


def test_non_local_zero_docs():
    cell = coverage_cell(_result(intent="legal", docs=0, specialty=None), today=date(2026, 1, 5))
    assert cell["cell_key"] == "-|legal|2026-W02"
    assert cell["zero_result"] == 1


def test_iso_week_format():
    assert iso_week(date(2026, 1, 1)) == "2026-W01"
    assert iso_week(date(2025, 12, 29)) == "2026-W01"  # ISO week boundaries
