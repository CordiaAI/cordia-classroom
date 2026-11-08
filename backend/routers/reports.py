"""Reporting a guide, a profile or a classroom (social plan, Stage 9). Rules in services/reports.py:
the reporter must be able to see the target, 20 reports a day, and 3 different reporters hold it
for an admin (the queue is /admin/queue)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import access
from access import Ctx
from ids import require_uuid
from rate_limit import ai_rate_limit
from services import reports

router = APIRouter(prefix="/reports", tags=["reports"])


class ReportRequest(BaseModel):
    target_type: Literal["guide", "profile", "classroom"]
    target_id: str
    reason: Literal["wrong", "copied_exam", "copyright", "inappropriate", "harassment"]


@router.post("", dependencies=[Depends(ai_rate_limit(10, 60))])
def file_report(body: ReportRequest, ctx: Ctx = Depends(access.own())):
    """Report something you can see. Reporting the same thing again changes your reason."""
    target_id = require_uuid(body.target_id, f"{body.target_type} ID")
    try:
        return reports.file(ctx.db, ctx.user_id, body.target_type, target_id, body.reason)
    except reports.Unavailable:
        raise HTTPException(status_code=503, detail="Reporting this isn't available yet. Use Send feedback instead.")
