"""
AFShow Schema v1.0.0
AquaFlow Show File Format Specification
"""

from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Optional, Any
from datetime import datetime
import hashlib
import json
import re
from pathlib import Path

# ============================================================
# Schema Version
# ============================================================

AFSHOW_SCHEMA_VERSION = "1.0.0"
AFSHOW_FILE_EXTENSION = ".afshow"
AFSHOW_MAGIC_BYTES = "AFSHOW"

# ============================================================
# Core Models
# ============================================================

class BeatMarkerV1(BaseModel):
    """Beat marker schema v1"""
    time: float = Field(..., ge=0, description="Time in seconds")
    bpm: float = Field(..., gt=0, le=300, description="Beats per minute")
    label: Optional[str] = Field(None, max_length=100)
    
    @field_validator('time')
    def validate_time(cls, v):
        if v < 0:
            raise ValueError('Time must be non-negative')
        return v
    
    @field_validator('bpm')
    def validate_bpm(cls, v):
        if v <= 0 or v > 300:
            raise ValueError('BPM must be between 1 and 300')
        return v


class EffectParamV1(BaseModel):
    """Effect parameter schema v1"""
    name: str = Field(..., max_length=100)
    value: Any
    type: str = Field(default="number")


class EffectV1(BaseModel):
    """Effect schema v1"""
    id: Optional[str] = Field(default=None, max_length=100)
    type: str = Field(..., max_length=50)
    name: Optional[str] = Field(default=None, max_length=100)
    startTime: float = Field(0, ge=0)
    duration: float = Field(1, gt=0)
    params: Dict[str, Any] = Field(default_factory=dict)
    
    @field_validator('type')
    def validate_type(cls, v):
        valid_types = ['jet_burst', 'fade_in', 'fade_out', 'pulse', 'wave', 'strobe', 'chase', 'color_fade', 'basic']
        if v not in valid_types:
            raise ValueError(f'Invalid effect type: {v}. Must be one of {valid_types}')
        return v


class ClipV1(BaseModel):
    """Timeline clip schema v1"""
    id: str
    name: str = Field(..., max_length=200)
    type: str = Field(..., max_length=50)
    trackId: str
    fixtureId: Optional[str] = None
    fixtures: List[str] = Field(default_factory=list)
    startTime: float = Field(0, ge=0)
    duration: float = Field(0.1, gt=0)
    value: float = Field(100, ge=0, le=100)
    color: str = Field("#00b7ff")
    fadeIn: float = Field(0, ge=0)
    fadeOut: float = Field(0, ge=0)
    curveType: str = Field("linear")
    effects: List[EffectV1] = Field(default_factory=list)
    locked: bool = False
    muted: bool = False
    
    # Motion parameters
    pan: float = Field(0, ge=-180, le=180)
    tilt: float = Field(0, ge=-180, le=180)
    angle: float = Field(0, ge=-180, le=180)
    
    # RGB parameters
    r: int = Field(255, ge=0, le=255)
    g: int = Field(255, ge=0, le=255)
    b: int = Field(255, ge=0, le=255)
    
    @field_validator('color')
    def validate_color(cls, v):
        if not v.startswith('#') or len(v) != 7:
            raise ValueError('Color must be hex format like #RRGGBB')
        return v
    
    @field_validator('curveType')
    def validate_curve_type(cls, v):
        valid_types = [
            'linear', 'step',
            'ease-in', 'ease-out', 'ease-in-out', 'ease-both',
            'pulse', 'wave', 'sine', 'bezier'
        ]
        if v not in valid_types:
            raise ValueError(f'Invalid curve type: {v}. Must be one of {valid_types}')
        return v


class CueV1(BaseModel):
    """Cue marker schema v1"""
    id: str
    number: int = Field(1, ge=1)
    label: str = Field(..., max_length=100)
    time: float = Field(..., ge=0)
    color: str = Field("#00d4ff")
    
    @field_validator('number')
    def validate_number(cls, v):
        if v < 1:
            raise ValueError('Cue number must be >= 1')
        return v
    
    @field_validator('color')
    def validate_color(cls, v):
        if not v.startswith('#') or len(v) != 7:
            raise ValueError('Color must be hex format like #RRGGBB')
        return v


class MetadataV1(BaseModel):
    """Show metadata schema v1"""
    title: str = Field(..., max_length=200)
    author: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    duration: float = Field(0, ge=0)
    bpm: float = Field(120, gt=0, le=300)
    tags: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class AFShowHeaderV1(BaseModel):
    """File header schema v1"""
    magic: str = Field(AFSHOW_MAGIC_BYTES)
    version: str = Field(AFSHOW_SCHEMA_VERSION)
    createdAt: str
    updatedAt: str
    checksum: str = Field(..., min_length=64, max_length=64)
    fileSize: int = Field(..., ge=0)


class AFShowV1(BaseModel):
    """Complete AFShow file schema v1"""
    header: AFShowHeaderV1
    metadata: MetadataV1
    timelineClips: List[ClipV1]
    beatMarkers: List[BeatMarkerV1]
    cues: List[CueV1]
    zoom: float = Field(80, ge=20, le=300)
    audioDuration: float = Field(0, ge=0)
    
 
    def to_json(self) -> str:
        """Convert to JSON string"""
        return json.dumps(self.model_dump(), indent=2, ensure_ascii=False)
    
    def calculate_checksum(self) -> str:
        """Calculate SHA256 checksum of data excluding header"""
        data = {k: v for k, v in self.model_dump().items() if k != 'header'}
        return hashlib.sha256(json.dumps(data, sort_keys=True).encode('utf-8')).hexdigest()


# ============================================================
# Schema Validator
# ============================================================

class AFShowValidator:
    """Validates AFShow files for corruption and schema compliance"""
    
    @staticmethod
    def validate_file(file_path: Path) -> Dict[str, Any]:
        """
        Validate an AFShow file on disk.
        
        Returns:
            {
                "valid": bool,
                "errors": List[str],
                "warnings": List[str],
                "schema_version": str,
                "data": dict or None
            }
        """
        errors = []
        warnings = []
        
        # Check file exists
        if not file_path.exists():
            return {
                "valid": False,
                "errors": [f"File not found: {file_path}"],
                "warnings": [],
                "schema_version": None,
                "data": None
            }
        
        # Check file extension
        if file_path.suffix.lower() != AFSHOW_FILE_EXTENSION:
            warnings.append(f"File extension should be {AFSHOW_FILE_EXTENSION}")
        
        # Read file
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            return {
                "valid": False,
                "errors": [f"Cannot read file: {str(e)}"],
                "warnings": [],
                "schema_version": None,
                "data": None
            }
        
        # Check empty file
        if not content or content.strip() == '':
            return {
                "valid": False,
                "errors": ["File is empty"],
                "warnings": [],
                "schema_version": None,
                "data": None
            }
        
        # Parse JSON
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            return {
                "valid": False,
                "errors": [f"Invalid JSON: {str(e)}"],
                "warnings": [],
                "schema_version": None,
                "data": None
            }
        
        # Check header exists
        if 'header' not in data:
            return {
                "valid": False,
                "errors": ["Missing header section"],
                "warnings": [],
                "schema_version": None,
                "data": None
            }
        
        # Check magic bytes
        if data.get('header', {}).get('magic') != AFSHOW_MAGIC_BYTES:
            return {
                "valid": False,
                "errors": [f"Invalid file format. Expected magic: {AFSHOW_MAGIC_BYTES}"],
                "warnings": [],
                "schema_version": None,
                "data": None
            }
        
        # Get schema version
        schema_version = data.get('header', {}).get('version')
        
        # Verify checksum
        expected_checksum = data.get('header', {}).get('checksum')
        if expected_checksum:
            # Recalculate checksum without the checksum field
            data_for_checksum = {k: v for k, v in data.items() if k != 'header'}
            temp_checksum = hashlib.sha256(json.dumps(data_for_checksum, sort_keys=True).encode()).hexdigest()
            
            if temp_checksum != expected_checksum:
                errors.append(f"Checksum mismatch. File may be corrupted.")
        
        # Validate against schema
        try:
            # Try to parse as v1
            if schema_version == "1.0.0":
                validated = AFShowV1(**data)
                return {
                    "valid": True,
                    "errors": errors,
                    "warnings": warnings,
                    "schema_version": schema_version,
                    "data": validated.model_dump()
                }
            else:
                # Unknown version - return with warning
                warnings.append(f"Unknown schema version: {schema_version}. Attempting to load as v1.0.0")
                try:
                    validated = AFShowV1(**data)
                    return {
                        "valid": True,
                        "errors": errors,
                        "warnings": warnings,
                        "schema_version": schema_version,
                        "data": validated.model_dump()
                    }
                except Exception as e:
                    return {
                        "valid": False,
                        "errors": [f"Schema validation failed: {str(e)}"],
                        "warnings": warnings,
                        "schema_version": schema_version,
                        "data": None
                    }
                    
        except Exception as e:
            return {
                "valid": False,
                "errors": [f"Schema validation failed: {str(e)}"],
                "warnings": warnings,
                "schema_version": schema_version,
                "data": None
            }
    
    @staticmethod
    def validate_data(data: Dict) -> Dict[str, Any]:
        """Validate raw dictionary data against schema"""
        try:
            validated = AFShowV1(**data)
            return {
                "valid": True,
                "errors": [],
                "warnings": [],
                "data": validated.model_dump()
            }
        except Exception as e:
            return {
                "valid": False,
                "errors": [f"Schema validation failed: {str(e)}"],
                "warnings": [],
                "data": None
            }


# ============================================================
# Migration Handler (Future Versions)
# ============================================================

class MigrationHandler:
    """Handles migration between schema versions"""
    
    @staticmethod
    def migrate(data: Dict, from_version: str, to_version: str) -> Dict:
        """
        Migrate data from one schema version to another.
        Currently supports v1.0.0 only. Placeholder for future versions.
        """
        if from_version == to_version:
            return data
        
        # Migration registry
        migrations = {
            "1.0.0": {
                "1.1.0": MigrationHandler._migrate_v1_0_0_to_v1_1_0,
            }
        }
        
        # Check if migration exists
        if from_version in migrations and to_version in migrations[from_version]:
            return migrations[from_version][to_version](data)
        
        # No migration path
        raise ValueError(f"No migration path from {from_version} to {to_version}")
    
    @staticmethod
    def _migrate_v1_0_0_to_v1_1_0(data: Dict) -> Dict:
        """Placeholder for future v1.0.0 to v1.1.0 migration"""
        # Add future migration logic here
        data['header']['version'] = "1.1.0"
        return data