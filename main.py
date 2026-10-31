"""
Solar Panel Analyzer — FastAPI Application (v4.0)
Auth-first, production-grade architecture
"""
import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

load_dotenv()

from app.routers import auth, analysis
from app.routers.subsidy import router as subsidy_router
from app.routers.csv_batch import router as csv_router
from app.routers.geocode import router as geocode_router
from app.database import engine, Base
from app.core.config import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("suryasys")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("⚡ SuryaSys starting up — creating DB tables...")
    Base.metadata.create_all(bind=engine)
    os.makedirs("data/uploads", exist_ok=True)
    os.makedirs("data/cache", exist_ok=True)
    os.makedirs("data/csv_uploads", exist_ok=True)
    logger.info("✅ SuryaSys ready")
    yield
    logger.info("SuryaSys shutting down")


app = FastAPI(
    title="SuryaSys — National Solar Energy Analyzer",
    description="AI-powered solar panel detection & verification system (PM Surya Ghar Yojana)",
    version="4.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# ── CORS ────────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global exception handler ─────────────────────────────────────────────────────
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None),
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
    )


# ── Routes ───────────────────────────────────────────────────────────────────────
app.include_router(auth.router,        prefix="/api/auth",     tags=["Authentication"])
app.include_router(analysis.router,    prefix="/api/analysis", tags=["Solar Analysis"])
app.include_router(subsidy_router,     prefix="/api/subsidy",  tags=["Subsidy Calculator"])
app.include_router(csv_router,         prefix="/api/csv",      tags=["CSV Batch Processing"])
app.include_router(geocode_router,     prefix="/api/geocode",  tags=["Geocoding"])


@app.get("/api/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "version": "4.0.0",
        "auth_enabled": True,
        "guest_mode": True,
        "db_type": "postgresql" if "postgresql" in settings.DATABASE_URL else "sqlite",
        "roboflow_configured": bool(settings.ROBOFLOW_API_KEY),
        "google_maps_configured": bool(settings.GOOGLE_MAPS_API_KEY),
        "ably_configured": bool(settings.ABLY_API_KEY),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
