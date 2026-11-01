"""Week-over-week Salesforce changes (SPEC section 5).

Compares this week's cleaned Salesforce deals to last week's cleaned file,
matched on match_key (first 15 characters of the ID). HubSpot has no
prior-week file, so it is not included. A deal can appear in more than one
category; its flags are shown alongside and never change its category.

Every change in expected value is stage-based (annual ACV x stage
probability, $0 if the deal isn't active in Q4), so the two weeks compare
like for like. A stage move and an ACV change on the same deal are split so
the parts add up to the deal's real change:
  stage move = (new probability - old probability) x last week's ACV
  ACV change = (new ACV - old ACV) x this week's probability
"""

from dataclasses import dataclass
from decimal import Decimal

from pipeline import config
from pipeline.checks import FLAG, AuditEntry
from pipeline.forecast import CLOSED_LOST as CLOSED_LOST_STAGE
from pipeline.forecast import is_active_q4, stage_expected_value
from pipeline.standardize import SALESFORCE, SALESFORCE_MATCH_KEY_LENGTH

NEW = "New Deals"
COPIED = "Copied from HubSpot"
SLIPPED = "Slipped (out of Q4)"
PULLED_IN = "Pulled into Q4"
QUARTER_OTHER = "Quarter changed (other)"
CLOSED_LOST = "Closed Lost"
STAGE_MOVES = "Stage Moves"
ACV_CHANGES = "ACV Changes"
MISSING = "Missing from current"
CATEGORIES = [NEW, COPIED, SLIPPED, PULLED_IN, QUARTER_OTHER, CLOSED_LOST, STAGE_MOVES, ACV_CHANGES, MISSING]

EV_BASIS = "stage-based"
ZERO = Decimal("0")


@dataclass
class Change:
    category: str
    label: str | None          # advanced / regressed / changed / expansion / contraction
    deal_id: str
    customer: str | None
    product: str | None
    sales_rep: str | None
    before: str | None
    after: str | None
    acv_change: Decimal | None  # ACV Changes only
    ev_change: Decimal
    ev_basis: str
    bucket: str | None          # Top / Longtail this week (None if not in the forecast)
    flags: list


@dataclass
class WeekOverWeek:
    changes: dict               # category -> [Change]
    couldnt_compare: list       # deals whose row was set aside in one of the weeks
    audit: list


def compare_weeks(current_deals, prior_deals, row_issues):
    now = {d["match_key"]: d for d in current_deals.to_dict("records") if d["source"] == SALESFORCE}
    before = {d["match_key"]: d for d in prior_deals.to_dict("records")}
    set_aside_now = _set_aside_keys(row_issues, config.FILES["sf_current"])
    set_aside_before = _set_aside_keys(row_issues, config.FILES["sf_prior"])

    changes = {category: [] for category in CATEGORIES}
    couldnt_compare, audit = [], []

    for key, deal in now.items():
        old = before.get(key)
        if old is None:
            if key in set_aside_before:
                _couldnt_compare(deal, "last week", couldnt_compare, audit)
            elif deal["duplicate_of"]:
                # D6: a Salesforce copy of a HubSpot deal is not a new deal.
                changes[COPIED].append(_change(COPIED, deal, None, f"Copy of HubSpot deal {deal['duplicate_of']}", ZERO))
            else:
                changes[NEW].append(_change(NEW, deal, None, f"{deal['stage']}, {_money(deal['annual_acv'])}",
                                            _counted(deal)))
            continue
        _compare_quarter(old, deal, changes)
        _compare_closed_lost(old, deal, changes)
        _compare_stage(old, deal, changes)
        _compare_acv(old, deal, changes)

    for key, old in before.items():
        if key in now:
            continue
        if key in set_aside_now:
            _couldnt_compare(old, "this week", couldnt_compare, audit)
        else:
            changes[MISSING].append(_change(MISSING, old, f"{old['stage']}, {_money(old['annual_acv'])}", None,
                                            -_counted(old)))

    return WeekOverWeek(changes=changes, couldnt_compare=couldnt_compare, audit=audit)


def _compare_quarter(old, deal, changes):
    if old["fiscal_period"] == deal["fiscal_period"]:
        return
    quarter = _quarter_index(config.FORECAST_QUARTER)
    was, now = _quarter_index(old["fiscal_period"]), _quarter_index(deal["fiscal_period"])
    if was == quarter and now > quarter:
        category = SLIPPED
    elif was > quarter and now == quarter:
        category = PULLED_IN
    else:
        category = QUARTER_OTHER  # catch-all so no quarter change disappears silently
    changes[category].append(_change(category, deal, old["fiscal_period"], deal["fiscal_period"],
                                     _counted(deal) - _counted(old)))


def _compare_closed_lost(old, deal, changes):
    # Decided by the Stage column, not the probability.
    if old["stage"] != CLOSED_LOST_STAGE and deal["stage"] == CLOSED_LOST_STAGE:
        changes[CLOSED_LOST].append(_change(CLOSED_LOST, deal, old["stage"], deal["stage"], -_counted(old)))


def _compare_stage(old, deal, changes):
    # Active Q4 deals whose stage changed. A missing stage in either week is
    # not a move (already flagged under SPEC 4.1).
    if not (is_active_q4(old) and is_active_q4(deal)):
        return
    if old["stage"] is None or deal["stage"] is None or old["stage"] == deal["stage"]:
        return
    order = config.STAGE_ORDER
    if old["stage"] in order and deal["stage"] in order:
        label = "advanced" if order.index(deal["stage"]) > order.index(old["stage"]) else "regressed"
    else:
        label = "changed"  # e.g. "On Hold" or "Closed Won": outside the stage order
    ev_change = (deal["stage_probability"] - old["stage_probability"]) * old["annual_acv"]
    changes[STAGE_MOVES].append(_change(STAGE_MOVES, deal, old["stage"], deal["stage"], ev_change, label=label))


def _compare_acv(old, deal, changes):
    if not (is_active_q4(old) and is_active_q4(deal)) or old["annual_acv"] == deal["annual_acv"]:
        return
    acv_change = deal["annual_acv"] - old["annual_acv"]
    changes[ACV_CHANGES].append(_change(
        ACV_CHANGES, deal, _money(old["annual_acv"]), _money(deal["annual_acv"]),
        acv_change * deal["stage_probability"],
        label="expansion" if acv_change > 0 else "contraction",
        acv_change=acv_change,
    ))


def _couldnt_compare(deal, week, couldnt_compare, audit):
    """The deal's row was set aside in one week, so there is nothing to compare.
    Not a change: listed separately and flagged so it doesn't vanish silently."""
    other_week = "last week" if week == "this week" else "this week"
    couldnt_compare.append({
        "deal_id": deal["deal_id"],
        "customer": deal["customer"],
        "product": deal["product"],
        "sales_rep": deal["sales_rep"],
        "week": week,
        "reason": f"Row set aside {week} (needs review); see the audit log",
    })
    audit.append(AuditEntry(
        check="WoW",
        kind=FLAG,
        records=[{"source_file": deal["source_file"], "source_row": deal["source_row"],
                  "deal_id": deal["deal_id"], "customer": deal["customer"]}],
        what_was_wrong=f"Deal is in {other_week}'s file, but its row {week} was set aside",
        resolution="Not compared week over week; listed under \"Couldn't compare\"",
        impact=ZERO,
        at_risk=_counted(deal),
    ))


def _change(category, deal, before, after, ev_change, label=None, acv_change=None):
    return Change(
        category=category,
        label=label,
        deal_id=deal["deal_id"],
        customer=deal["customer"],
        product=deal["product"],
        sales_rep=deal["sales_rep"],
        before=before,
        after=after,
        acv_change=acv_change,
        ev_change=ev_change,
        ev_basis=EV_BASIS,
        bucket=deal.get("bucket"),
        flags=list(deal.get("flags") or []),
    )


def _set_aside_keys(row_issues, file_name):
    """match_keys of rows set aside in one file. Rows with no ID can't be linked, so aren't included."""
    return {
        issue.record[:SALESFORCE_MATCH_KEY_LENGTH]
        for issue in row_issues
        if issue.row_excluded and issue.source_file == file_name and issue.record
    }


def _counted(deal):
    """Stage-based expected value the deal adds to the Q4 forecast that week."""
    return stage_expected_value(deal) if is_active_q4(deal) else ZERO


def _quarter_index(fiscal_period):
    """"Q4-2026" -> a number that sorts quarters in time order."""
    quarter, year = fiscal_period.split("-")
    return int(year) * 4 + int(quarter[1])


def _money(amount):
    return f"${amount:,.0f}"
