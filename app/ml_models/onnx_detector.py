"""
ONNX-based Solar Panel Detector using trained weights.onnx (YOLOv11s)
"""
import io
import os
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# Search paths for weights.onnx
POSSIBLE_MODEL_PATHS = [
    Path("data/models/weights.onnx"),
    Path("data/models/aipsi/1/weights.onnx"),
    Path(__file__).resolve().parent.parent.parent / "data" / "models" / "weights.onnx",
    Path(__file__).resolve().parent.parent.parent / "data" / "models" / "aipsi" / "1" / "weights.onnx",
]

_session = None
_model_path_used = None


def get_onnx_session():
    """Lazy initialize and return onnxruntime InferenceSession."""
    global _session, _model_path_used
    if _session is not None:
        return _session

    try:
        import onnxruntime as ort
    except ImportError:
        logger.warning("onnxruntime is not installed. ONNX detection unavailable.")
        return None

    for p in POSSIBLE_MODEL_PATHS:
        if p.exists():
            try:
                # Use CPU execution provider for maximum compatibility across environments
                providers = ["CPUExecutionProvider"]
                if "CUDAExecutionProvider" in ort.get_available_providers():
                    providers.insert(0, "CUDAExecutionProvider")
                
                sess = ort.InferenceSession(str(p), providers=providers)
                _session = sess
                _model_path_used = str(p)
                logger.info(f"Loaded ONNX model from: {_model_path_used}")
                return _session
            except Exception as e:
                logger.error(f"Error loading ONNX model from {p}: {e}")

    logger.warning("Could not find weights.onnx in expected locations.")
    return None


def run_nms(boxes: np.ndarray, scores: np.ndarray, iou_thresh: float = 0.45) -> List[int]:
    """
    Standard Non-Maximum Suppression (NMS).
    boxes: (N, 4) in [x_center, y_center, width, height] format
    """
    x1 = boxes[:, 0] - boxes[:, 2] / 2
    y1 = boxes[:, 1] - boxes[:, 3] / 2
    x2 = boxes[:, 0] + boxes[:, 2] / 2
    y2 = boxes[:, 1] + boxes[:, 3] / 2

    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []

    while order.size > 0:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])

        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)

        inds = np.where(iou <= iou_thresh)[0]
        order = order[inds + 1]

    return keep


def detect_with_onnx_weights(
    image_bytes: bytes,
    conf_threshold: float = 0.20,
    iou_threshold: float = 0.45
) -> Optional[Dict[str, Any]]:
    """
    Run inference on image_bytes using weights.onnx.
    Returns structured dict or None if ONNX cannot be run.
    """
    session = get_onnx_session()
    if session is None:
        return None

    try:
        # 1. Load image and keep original dimensions
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        orig_w, orig_h = img.size

        # 2. Resize to 640x640 expected by YOLOv11
        img_resized = img.resize((640, 640), Image.Resampling.BILINEAR)
        img_np = np.array(img_resized, dtype=np.float32) / 255.0
        # Transpose from (H, W, C) to (1, C, H, W)
        input_tensor = img_np.transpose(2, 0, 1)[np.newaxis, ...]

        # 3. Run inference
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: input_tensor})[0]

        # YOLO output is (1, 6, 8400) -> transpose to (8400, 6)
        preds = outputs[0].T
        boxes = preds[:, :4]  # [x_center, y_center, w, h] in 640x640
        scores = preds[:, 4:]  # class scores

        # Classes: 0: Solarpanel, 1: solarpanel
        max_scores = np.max(scores, axis=1)
        class_ids = np.argmax(scores, axis=1)

        mask = max_scores >= conf_threshold
        filtered_boxes = boxes[mask]
        filtered_scores = max_scores[mask]
        filtered_classes = class_ids[mask]

        predictions: List[Dict[str, Any]] = []
        if len(filtered_boxes) > 0:
            keep_indices = run_nms(filtered_boxes, filtered_scores, iou_thresh=iou_threshold)
            scale_x = orig_w / 640.0
            scale_y = orig_h / 640.0

            for idx in keep_indices:
                box = filtered_boxes[idx]
                score = float(filtered_scores[idx])
                cls_id = int(filtered_classes[idx])

                # Scale coordinates to original image
                xc = float(box[0] * scale_x)
                yc = float(box[1] * scale_y)
                w = float(box[2] * scale_x)
                h = float(box[3] * scale_y)

                predictions.append({
                    "class": "Solarpanel",
                    "confidence": round(score, 4),
                    "bbox": [round(xc - w / 2, 1), round(yc - h / 2, 1), round(w, 1), round(h, 1)],
                    "center": [round(xc, 1), round(yc, 1)],
                })

        panel_count = len(predictions)
        has_solar = panel_count > 0
        avg_conf = float(np.mean([p["confidence"] for p in predictions])) if panel_count > 0 else 0.0

        pv_area_sqm = round(panel_count * 1.65, 2)
        capacity_kw = round(panel_count * 0.35, 2)

        return {
            "has_solar": has_solar,
            "panel_count": panel_count,
            "confidence": round(avg_conf, 4),
            "pv_area_sqm": pv_area_sqm,
            "capacity_kw": capacity_kw,
            "predictions": predictions,
            "model_used": "YOLOv11s ONNX (weights.onnx)",
            "qc_notes": [
                f"Model: YOLOv11s ONNX local weights (640x640)",
                f"ESRI 3D SceneView viewport capture",
                f"Detections: {panel_count} panel(s) confirmed (conf >= {conf_threshold})",
                f"Active PV Area: {pv_area_sqm} m² | Est. Capacity: {capacity_kw} kW",
                f"NMS filtering applied with IoU threshold {iou_threshold}"
            ]
        }
    except Exception as e:
        logger.error(f"ONNX detection error: {e}", exc_info=True)
        return None

