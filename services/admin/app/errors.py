"""Unified error shape for FastAPI services: { error: { code, message, details? } }.

Register once per service: `register_error_handlers(app)` right after the
FastAPI app is constructed. Overrides the default {detail: "..."} format.
"""
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _error_body(code: str, message: str, details: Optional[object] = None) -> dict:
    body: dict = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def _http_exc(_: Request, exc: HTTPException):
        code = f"http_{exc.status_code}"
        if isinstance(exc.detail, str):
            message, details = exc.detail, None
        elif isinstance(exc.detail, dict):
            message = exc.detail.get("message") or exc.detail.get("detail") or "error"
            details = exc.detail
        else:
            message, details = str(exc.detail), None
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(code, message, details),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exc(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        first = errors[0] if errors else {}
        message = first.get("msg", "validation error")
        return JSONResponse(
            status_code=422,
            content=_error_body("validation_error", message, {"errors": errors}),
        )

    @app.exception_handler(Exception)
    async def _unhandled_exc(_: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content=_error_body("internal_error", str(exc) or "internal error"),
        )
