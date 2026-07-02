import multiprocessing
import uvicorn
from main import app


if __name__ == "__main__":
    multiprocessing.freeze_support()

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=False,
        workers=1,
    )