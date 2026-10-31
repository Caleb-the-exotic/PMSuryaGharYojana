import os
from pathlib import Path

# 1. Target directory: data/models
PROJECT_ROOT = Path(__file__).resolve().parent
MODEL_DIR = PROJECT_ROOT / "data" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# 2. Configure environment variable for Roboflow inference cache
os.environ["MODEL_CACHE_DIR"] = str(MODEL_DIR)

from inference import get_model

# 3. Model details
MODEL_ID = "aipsi/1"
API_KEY = "OXBEWKWomWatf7e19kyj"

print(f"Downloading model '{MODEL_ID}' into: {MODEL_DIR}...")

# 4. Download weights
model = get_model(model_id=MODEL_ID, api_key=API_KEY)

print("Model downloaded successfully into data/models!")
