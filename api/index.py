import sys
from pathlib import Path

# Add project root directory to sys.path so that `import app` and `from main import app` resolve
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from main import app
