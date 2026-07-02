from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict, Any

class AutosaveMetadata(BaseModel):
    autosaveId: str
    timestamp: datetime
    sessionId: str
    clipCount: int
    checksum: str
    programId: Optional[str] = None
    programName: Optional[str] = None

class AutosaveData(BaseModel):
    metadata: AutosaveMetadata
    programData: Dict[str, Any]

class AutosaveCreateRequest(BaseModel):
    sessionId: str
    programData: Dict[str, Any]
    programId: Optional[str] = None
    programName: Optional[str] = None

class AutosaveRecoveryResponse(BaseModel):
    found: bool
    autosave: Optional[AutosaveData] = None
    latestTimestamp: Optional[datetime] = None
    autosaveCount: Optional[int] = None

class AutosaveCleanupResponse(BaseModel):
    deleted: int
    kept: int
    message: str

class AutosaveValidationResult(BaseModel):
    valid: bool
    error: Optional[str] = None
    checksumMatch: Optional[bool] = None