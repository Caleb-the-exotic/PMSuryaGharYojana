"""
Application configuration
"""
from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "Surya Sys — National Solar Analyzer"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # Database (SQLite fallback for dev; use PostgreSQL in production)
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "sqlite:///./solar_analyzer.db"
    )

    # JWT
    SECRET_KEY: str = os.getenv("SECRET_KEY", "your-super-secret-key-change-this-in-production-min-32-characters-long")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))  # 8 hours

    # CORS — allow both Vite dev ports + production frontend URL
    @property
    def cors_origins_list(self) -> List[str]:
        origins = [
            "http://localhost:5173",
            "http://localhost:5174",
            "http://localhost:8000",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
            "http://127.0.0.1:8000",
            "http://127.0.0.1:3000",
        ]
        if self.FRONTEND_URL:
            origins.append(self.FRONTEND_URL)
        return origins

    # Keep the old field for backward compatibility (used by main.py)
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:3000",
    ]

    # External APIs — NEVER expose to frontend; all calls go through backend
    GOOGLE_MAPS_API_KEY: str = os.getenv("GOOGLE_MAPS_API_KEY", "")
    ROBOFLOW_API_KEY: str = os.getenv("ROBOFLOW_API_KEY", "OXBEWKWomWatf7e19kyj")
    ROBOFLOW_MODEL_ID: str = os.getenv("ROBOFLOW_MODEL_ID", "aipsi/1")
    ABLY_API_KEY: str = os.getenv("ABLY_API_KEY", "")
    NASA_POWER_API_KEY: str = os.getenv("NASA_POWER_API_KEY", "")
    ESRI_API_KEY: str = os.getenv("ESRI_API_KEY", "")

    # Google OAuth — used ONLY for sign-in token verification
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    VITE_GOOGLE_CLIENT_ID: str = os.getenv("VITE_GOOGLE_CLIENT_ID", "")

    # Frontend URL — add your production domain here for CORS
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "")

    # ML Models
    ML_MODELS_DIR: str = os.getenv("ML_MODELS_DIR", "model_weights")
    ML_MODEL_PATH: str = os.getenv("ML_MODEL_PATH", "model_weights/solar_detector.pth")

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # Allow VITE_* and other extra vars in .env without failing


settings = Settings()
