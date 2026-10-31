"""
Solar analysis routes
- POST /api/analysis/analyze-location — one-shot lat/lon / viewport screenshot → run inference → return result
  Guest: runs but does NOT persist to DB
  Auth: persists and links to user
- GET  /api/analysis/history — authenticated user's history
- GET  /api/analysis/{id}    — get specific analysis (owner only)
- DELETE /api/analysis/{id}  — delete analysis (owner only)
"""
import os
import uuid
import base64
import logging
import requests
from io import BytesIO
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from PIL import Image

from app.database import get_db
from app.models import User, SolarAnalysis, AnalysisResult, UploadedImage
from app.schemas import AnalyzeLocationRequest, AnalyzeLocationResponse, AnalysisResponse
from app.dependencies import get_current_user_optional, get_current_user
from app.core.config import settings
from app.services.satellite import SatelliteImageryService
from app.ml_models.onnx_detector import detect_with_onnx_weights

logger = logging.getLogger(__name__)
router = APIRouter()

os.makedirs("data/uploads", exist_ok=True)
os.makedirs("data/cache", exist_ok=True)


# ── helpers ─────────────────────────────────────────────────────────────────────

def _estimate_pv_area(panel_count: int) -> float:
    return round(panel_count * 1.65, 2)


def _estimate_capacity_kw(panel_count: int) -> float:
    return round(panel_count * 0.35, 2)


def _derive_qc_status(confidence: float, has_solar: bool) -> str:
    if not has_solar:
        return "NO_SOLAR_DETECTED"
    if confidence >= 0.70:
        return "VERIFIABLE"
    if confidence >= 0.35:
        return "PARTIALLY_VERIFIABLE"
    return "PENDING"


def _dynamic_crop_image(image_bytes: bytes, latitude: float, longitude: float, zoom: int = 18) -> bytes:
    """
    Dynamically crop the satellite image around the clicked location.
    Returns the cropped image bytes.
    """
    try:
        img = Image.open(BytesIO(image_bytes))
        width, height = img.size
        
        crop_size = min(width, height) // 2
        center_x = width // 2
        center_y = height // 2
        
        left = max(0, center_x - crop_size // 2)
        top = max(0, center_y - crop_size // 2)
        right = min(width, left + crop_size)
        bottom = min(height, top + crop_size)
        
        cropped_img = img.crop((left, top, right, bottom))
        
        output = BytesIO()
        cropped_img.save(output, format='JPEG', quality=95)
        return output.getvalue()
    except Exception as e:
        logger.warning(f"Failed to crop image, using original: {e}")
        return image_bytes


def _call_roboflow_workflow(image_bytes: bytes, latitude: float, longitude: float) -> dict:
    """
    Call Roboflow inference using the workflow API via HTTP.
    Uses dynamic cropping based on the clicked location.
    """
    if not settings.ROBOFLOW_API_KEY:
        raise HTTPException(status_code=503, detail="ROBOFLOW_API_KEY not configured")

    cropped_image = _dynamic_crop_image(image_bytes, latitude, longitude)
    
    api_url = "https://serverless.roboflow.com"
    workflow_id = "detect-and-classify-4"
    workspace_name = "calebs-workspace-su9rp"
    
    files = {
        "image": ("image.jpg", cropped_image, "image/jpeg")
    }
    
    data = {
        "api_key": settings.ROBOFLOW_API_KEY,
        "use_cache": "true"
    }
    
    url = f"{api_url}/workflow/{workspace_name}/{workflow_id}"
    
    response = requests.post(url, files=files, data=data, timeout=60)
    response.raise_for_status()
    result = response.json()
    
    logger.info(f"Roboflow workflow result: {result}")
    
    predictions = []
    has_solar = False
    panel_count = 0
    avg_conf = 0.0
    
    if result:
        if "predictions" in result:
            preds = result["predictions"]
            if isinstance(preds, list):
                predictions = preds
                panel_count = len(preds)
                has_solar = panel_count > 0
                if panel_count > 0:
                    avg_conf = sum(p.get("confidence", 0) for p in preds) / panel_count
        
        if "solar_panel_directed" in result:
            has_solar = result["solar_panel_directed"]
    
    return {
        "has_solar": has_solar,
        "panel_count": panel_count,
        "confidence": round(avg_conf, 4) if avg_conf > 0 else 0.0,
        "predictions": predictions,
        "model_used": "roboflow_workflow_detect_and_classify_4",
        "qc_notes": [
            "Imagery analyzed via Roboflow cloud workflow",
            f"Detected panels: {panel_count}",
            f"Confidence: {round(avg_conf * 100, 1)}%"
        ]
    }


def _call_roboflow(image_bytes: bytes, latitude: float = 0, longitude: float = 0) -> dict:
    """Wrapper that uses workflow-based inference with dynamic cropping"""
    return _call_roboflow_workflow(image_bytes, latitude, longitude)


# ── routes ───────────────────────────────────────────────────────────────────────

@router.post("/analyze-location", response_model=AnalyzeLocationResponse)
async def analyze_location(
    body: AnalyzeLocationRequest,
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """
    Fetch satellite tile or decode 3D viewport screenshot → run ONNX weights (or workflow) inference → return structured result.
    Guest users: result is returned but NOT stored in DB.
    Authenticated users: result is stored and linked to their account.
    """
    image_bytes = None
    satellite_source = "esri_world_imagery"

    # 1. Use 3D container viewport screenshot if provided
    if body.image_base64:
        try:
            raw_b64 = body.image_base64
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            image_bytes = base64.b64decode(raw_b64)
            satellite_source = f"esri_3d_viewport_{body.buffer_radius or '1200'}ft"
            logger.info(f"Received 3D viewport screenshot ({len(image_bytes)} bytes) for {body.latitude}, {body.longitude}")
        except Exception as e:
            logger.error(f"Failed to decode image_base64: {e}")

    # 2. Fall back to Esri satellite tile if no screenshot provided
    if not image_bytes:
        image_bytes = SatelliteImageryService.fetch_satellite_image(
            body.latitude, body.longitude, zoom=body.zoom or 18
        )
    if not image_bytes:
        raise HTTPException(status_code=503, detail="Failed to fetch satellite imagery")

    # 3. Primary inference: Run local YOLOv11s weights.onnx
    inference = detect_with_onnx_weights(image_bytes)

    # 4. Fallback inference: Roboflow workflow if local ONNX unavailable
    if not inference:
        try:
            inference = _call_roboflow(image_bytes, body.latitude, body.longitude)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Inference failed: {e}")
            raise HTTPException(status_code=500, detail=f"Inference failed: {str(e)}")

    panel_count = inference["panel_count"]
    confidence = inference["confidence"]
    has_solar = inference["has_solar"]
    predictions = inference["predictions"]
    model_used = inference.get("model_used", "YOLOv11s ONNX (weights.onnx)")
    qc_notes = inference.get("qc_notes", [])

    pv_area = inference.get("pv_area_sqm") or _estimate_pv_area(panel_count)
    capacity_kw = inference.get("capacity_kw") or _estimate_capacity_kw(panel_count)
    qc_status = _derive_qc_status(confidence, has_solar)

    sample_id = body.sample_id or f"SOLAR_{uuid.uuid4().hex[:8].upper()}"
    saved_to_db = False
    analysis_id = None

    if current_user:
        # Persist to database
        db_analysis = SolarAnalysis(
            user_id=current_user.id,
            sample_id=sample_id,
            latitude=body.latitude,
            longitude=body.longitude,
            address=body.address,
            status="completed",
        )
        db.add(db_analysis)
        db.commit()
        db.refresh(db_analysis)

        db_result = AnalysisResult(
            analysis_id=db_analysis.id,
            has_solar=has_solar,
            confidence=confidence,
            panel_count=panel_count,
            pv_area_sqm=pv_area,
            capacity_kw=capacity_kw,
            qc_status=qc_status,
            model_used=model_used,
            raw_predictions={"predictions": predictions},
        )
        db.add(db_result)

        # Cache image to disk
        cache_filename = f"{sample_id}_{uuid.uuid4().hex[:6]}.jpg"
        cache_path = os.path.join("data/cache", cache_filename)
        with open(cache_path, "wb") as f:
            f.write(image_bytes)

        db_image = UploadedImage(
            analysis_id=db_analysis.id,
            file_path=cache_path,
            file_size=len(image_bytes),
            source="satellite",
            satellite_provider="esri",
        )
        db.add(db_image)
        db.commit()

        saved_to_db = True
        analysis_id = db_analysis.id

    return AnalyzeLocationResponse(
        sample_id=sample_id,
        latitude=body.latitude,
        longitude=body.longitude,
        address=body.address,
        has_solar=has_solar,
        confidence=confidence,
        panel_count=panel_count,
        pv_area_sqm=pv_area,
        capacity_kw=capacity_kw,
        qc_status=qc_status,
        model_used=model_used,
        satellite_image_source=satellite_source,
        predictions=predictions,
        saved_to_db=saved_to_db,
        analysis_id=analysis_id,
        qc_notes=qc_notes,
    )


@router.get("/history", response_model=List[AnalysisResponse])
async def get_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the authenticated user's analysis history."""
    analyses = (
        db.query(SolarAnalysis)
        .filter(SolarAnalysis.user_id == current_user.id)
        .order_by(SolarAnalysis.analysis_timestamp.desc())
        .limit(50)
        .all()
    )
    return analyses


@router.get("/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis(
    analysis_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a specific analysis — must be the owner."""
    analysis = db.query(SolarAnalysis).filter(SolarAnalysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if analysis.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return analysis


@router.delete("/{analysis_id}", status_code=204)
async def delete_analysis(
    analysis_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an analysis — must be the owner."""
    analysis = db.query(SolarAnalysis).filter(SolarAnalysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    if analysis.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(analysis)
    db.commit()
    return None
