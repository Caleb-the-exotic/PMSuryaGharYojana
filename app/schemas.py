"""
Pydantic schemas for request/response validation
"""
from pydantic import BaseModel, field_validator
try:
    import email_validator
    from pydantic import EmailStr
except ImportError:
    EmailStr = str  # Fallback if email-validator is not installed
from typing import Optional, List, Dict, Any
from datetime import datetime


# ── Auth Schemas ────────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    email: EmailStr
    username: str
    password: str
    full_name: Optional[str] = None

    @field_validator("username")
    @classmethod
    def username_alphanumeric(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    user: "UserResponse"


class GoogleAuthRequest(BaseModel):
    """Payload from the frontend after a successful Google Sign-In popup."""
    credential: str  # The raw Google ID token (JWT) from Google Identity Services


class UserResponse(BaseModel):
    id: int
    email: str
    username: Optional[str]
    full_name: Optional[str]
    is_active: bool
    profile_picture: Optional[str] = None
    auth_provider: str = "local"
    created_at: datetime

    class Config:
        from_attributes = True


# ── Analysis Schemas ─────────────────────────────────────────────────────────────

class AnalyzeLocationRequest(BaseModel):
    latitude: float
    longitude: float
    sample_id: Optional[str] = None
    address: Optional[str] = None
    zoom: Optional[int] = 18
    buffer_radius: Optional[str] = "1200"
    image_base64: Optional[str] = None


class AnalysisResultResponse(BaseModel):
    id: int
    analysis_id: int
    has_solar: bool
    confidence: float
    panel_count: int
    pv_area_sqm: Optional[float]
    capacity_kw: Optional[float]
    qc_status: str
    model_used: Optional[str]
    raw_predictions: Optional[Dict[str, Any]]
    created_at: datetime

    class Config:
        from_attributes = True


class AnalysisResponse(BaseModel):
    id: int
    sample_id: str
    latitude: float
    longitude: float
    address: Optional[str]
    analysis_timestamp: datetime
    status: str
    user_id: Optional[int] = None
    result: Optional[AnalysisResultResponse] = None

    class Config:
        from_attributes = True


class AnalyzeLocationResponse(BaseModel):
    """One-shot analyze + result response (used by frontend)"""
    sample_id: str
    latitude: float
    longitude: float
    address: Optional[str]
    has_solar: bool
    confidence: float
    panel_count: int
    pv_area_sqm: Optional[float]
    capacity_kw: Optional[float]
    qc_status: str
    model_used: str
    satellite_image_source: str
    predictions: List[Dict[str, Any]]
    saved_to_db: bool  # True if user is authenticated and result was persisted
    analysis_id: Optional[int] = None
    qc_notes: Optional[List[str]] = None


# ── Subsidy Schemas ──────────────────────────────────────────────────────────────

class SubsidyRequest(BaseModel):
    state: str
    estimated_capacity_kw: float
    panel_count: Optional[int] = 0
    sample_id: Optional[str] = None  # If linked to an analysis


class SubsidyResponse(BaseModel):
    state: str
    estimated_capacity_kw: float
    panel_count: int
    subsidy_min: float
    subsidy_max: float
    avg_subsidy: float
    currency: str = "INR"
    sample_id: Optional[str] = None
    saved_to_db: bool = False
    calculation_id: Optional[int] = None


# ── CSV Batch Schemas ────────────────────────────────────────────────────────────

class BatchJobResponse(BaseModel):
    id: int
    original_filename: Optional[str]
    total_rows: int
    processed_rows: int
    failed_rows: int
    status: str
    error_message: Optional[str]
    result_json: Optional[Any]
    created_at: datetime
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Geocode Schemas ──────────────────────────────────────────────────────────────

class GeocodeResponse(BaseModel):
    display_name: str
    latitude: float
    longitude: float
    address_components: Optional[Dict[str, Any]] = None


# Update forward ref
Token.model_rebuild()
