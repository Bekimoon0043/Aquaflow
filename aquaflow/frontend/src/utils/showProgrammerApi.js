// frontend/src/utils/showProgrammerApi.js
// API helper for Show Programmer backend persistence
// With timeout handling, retry logic, and error recovery

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const SHOW_PROGRAMMER_API = `${API_BASE_URL}/api/show-programmer`;

// Configuration
const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
/**
 * Standardized API response wrapper
 * Ensures consistent response shape for all API calls
 */
function createApiResponse(success, data = null, error = null) {
  return { success, data, error };
}

/**
 * Fetch with timeout and retry logic
 */
async function fetchWithTimeout(url, options = {}, retryCount = 0) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Retry logic for network errors (not HTTP errors)
    if (retryCount < MAX_RETRIES && (error.name === 'AbortError' || error.name === 'TypeError')) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return fetchWithTimeout(url, options, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Safe JSON parse with error handling
 */
async function safeJsonParse(response) {
  try {
    return await response.json();
  } catch (error) {
    console.error('[API] JSON parse failed:', error);
    return null;
  }
}

/**
 * Validate program data structure before loading
 */
export function validateProgramData(program) {
  if (!program || typeof program !== 'object') {
    return { valid: false, error: 'Invalid program data structure' };
  }
  
  // Required fields
  const requiredFields = ['timelineClips', 'beatMarkers', 'cues', 'audioDuration', 'zoom'];
  const missingFields = requiredFields.filter(field => !(field in program));
  
  if (missingFields.length > 0) {
    return { valid: false, error: `Missing required fields: ${missingFields.join(', ')}` };
  }
  
  // Type validation
  if (!Array.isArray(program.timelineClips)) {
    return { valid: false, error: 'timelineClips must be an array' };
  }
  
  if (!Array.isArray(program.beatMarkers)) {
    return { valid: false, error: 'beatMarkers must be an array' };
  }
  
  if (!Array.isArray(program.cues)) {
    return { valid: false, error: 'cues must be an array' };
  }
  
  if (typeof program.audioDuration !== 'number' || program.audioDuration <= 0) {
    return { valid: false, error: 'audioDuration must be a positive number' };
  }
  
  if (typeof program.zoom !== 'number' || program.zoom < 20 || program.zoom > 300) {
    return { valid: false, error: 'zoom must be between 20 and 300' };
  }
  
  // Check for corrupt data (NaN, undefined, etc.)
  if (isNaN(program.audioDuration) || isNaN(program.zoom)) {
    return { valid: false, error: 'Corrupt numeric values detected' };
  }
  
  return { valid: true };
}

/**
 * Health check endpoint
 */
export async function checkBackendHealth() {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    const data = await safeJsonParse(response);
    return { 
      success: true, 
      status: data?.status || 'unknown',
      version: data?.version,
      safety: data?.safety?.state
    };
  } catch (error) {
    console.error('[API] Health check failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * List all saved programs from backend
 */
export async function listPrograms() {
  try {
    const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/programs/list`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    return createApiResponse(true, {
      programs: data?.programs || [],
      total: data?.total || 0
    }, null);
  } catch (error) {
    console.error('[API] listPrograms failed:', error);
    return createApiResponse(false, { programs: [], total: 0 }, error.message);
  }
}

/**
 * Save program to backend
 */
export async function saveProgramToBackend(programData) {
  // Validate input before sending
  if (!programData.name || programData.name.trim() === '') {
    return createApiResponse(false, null, 'Program name is required');
  }
  
  if (!Array.isArray(programData.timelineClips)) {
    return createApiResponse(false, null, 'timelineClips must be an array');
  }
  
  if (typeof programData.audioDuration !== 'number' || programData.audioDuration <= 0) {
    return createApiResponse(false, null, 'audioDuration must be a positive number');
  }
  
  try {
    const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/programs/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(programData),
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    return createApiResponse(true, {
      program_id: data.program_id,
      name: data.name,
      saved_at: data.saved_at,
      stats: data.stats
    }, null);
  } catch (error) {
    console.error('[API] saveProgramToBackend failed:', error);
    return createApiResponse(false, null, error.message);
  }
}

/**
 * Load program from backend by ID
 */

/**
 * Delete program from backend by ID
 */
export async function deleteProgramFromBackend(programId) {
  if (!programId || typeof programId !== 'string') {
    return createApiResponse(false, null, 'Invalid program ID');
  }
  
  try {
    const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/programs/${programId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    return createApiResponse(true, {
      program_id: data.program_id,
      deleted_at: data.deleted_at
    }, null);
  } catch (error) {
    console.error('[API] deleteProgramFromBackend failed:', error);
    return createApiResponse(false, null, error.message);
  }
}

/**
 * Compile program using backend (stub)
 */
export async function compileProgram(programId, outputFormat = 'json', dryRun = false) {
  if (!programId || typeof programId !== 'string') {
    return createApiResponse(false, null, 'Invalid program ID');
  }
  
  try {
    const url = dryRun 
      ? `${SHOW_PROGRAMMER_API}/compile?dryRun=true`
      : `${SHOW_PROGRAMMER_API}/compile`;
    
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: programId,
        output_format: outputFormat,
        dryRun: dryRun,
      }),
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail?.message || errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    
    // NEW: For dry-run, also return the compiled events for frontend playback
    const result = {
      compiled: data.compiled,
      report: data.report,
      validationPassed: data.validationPassed,
      warnings: data.warnings,
      dryRun: data.dryRun,
    };
    
    // NEW: Include compiled events if available (dry-run mode)
    if (data.dryRun && data.compiled && data.compiled.events) {
      result.events = data.compiled.events;
      result.eventCount = data.compiled.events.length;
    }
    
    return createApiResponse(true, result, null);
  } catch (error) {
    console.error('[API] compileProgram failed:', error);
    return createApiResponse(false, null, error.message);
  }
}

/**
 * Test backend connectivity (simple ping)
 */
export async function testBackendConnection() {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    return response.ok;
  } catch (error) {
    console.error('[API] Backend connection test failed:', error);
    return false;
  }
}


/**
 * Validate a show program using backend
 * @param {Object} params - { clips, fixtures, program_id }
 * @returns {Promise<{success: boolean, valid: boolean, errors: Array, warnings: Array, stats: Object, error?: string}>}
 */
export async function validateShowProgram(params = {}) {
  const { clips = null, fixtures = null, program_id = null } = params;
  
  // Build request body
  const requestBody = {};
  if (program_id) {
    requestBody.program_id = program_id;
  } else {
    if (clips !== null) requestBody.timelineClips = clips;
    if (fixtures !== null) requestBody.fixtures = fixtures;  }
  
  // Validate request has data
  if (!program_id && clips === null && fixtures === null) {
    return createApiResponse(false, {
      valid: false,
      errors: [{ type: 'no_data', message: 'No clips, fixtures, or program_id provided' }],
      warnings: [],
      estimatedDuration: 0,
      overlapCount: 0,
      unsupportedTrackTypes: [],
      stats: {
        totalClips: 0,
        totalTracks: 0,
        estimatedDurationSeconds: 0,
        formattedDuration: '0:00',
        totalEffects: 0,
        clipsWithEffects: 0,
        clipsWithoutEffects: 0,
        trackTypeDistribution: {},
        errorCount: 1,
        warningCount: 0
      }
    }, 'No validation data provided');
  }
  
  try {
const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    return createApiResponse(true, {
      valid: data.valid === true,
      errors: data.errors || [],
      warnings: data.warnings || [],
      estimatedDuration: data.estimatedDuration || 0,
      overlapCount: data.overlapCount || 0,
      unsupportedTrackTypes: data.unsupportedTrackTypes || [],
      stats: data.stats || {
        totalClips: 0,
        totalTracks: 0,
        estimatedDurationSeconds: 0,
        formattedDuration: '0:00',
        totalEffects: 0,
        clipsWithEffects: 0,
        clipsWithoutEffects: 0,
        trackTypeDistribution: {},
        errorCount: 0,
        warningCount: 0
      }
    }, null);
  } catch (error) {
    console.error('[API] validateShowProgram failed:', error);
    return createApiResponse(false, {
      valid: false,
      errors: [{ type: 'validation_failed', message: error.message }],
      warnings: [],
      estimatedDuration: 0,
      overlapCount: 0,
      unsupportedTrackTypes: [],
      stats: {
        totalClips: 0,
        totalTracks: 0,
        estimatedDurationSeconds: 0,
        formattedDuration: '0:00',
        totalEffects: 0,
        clipsWithEffects: 0,
        clipsWithoutEffects: 0,
        trackTypeDistribution: {},
        errorCount: 0,
        warningCount: 0
      }
    }, error.message);
  }
}

/**
 * Quick validation for current timeline (local schema compatible)
 * @param {Array} timelineClips - Current timeline clips
 * @param {Array} fixtures - Available fixtures
 * @returns {Promise<{valid: boolean, errors: Array, warnings: Array, stats: Object}>}
 */
export async function validateCurrentTimeline(timelineClips = [], fixtures = []) {
  // Convert timeline clips to backend format
  const formattedClips = timelineClips.map(clip => ({
    id: clip.id,
    name: clip.name || 'Untitled',
    type: clip.type || 'unknown',
    trackId: clip.trackId,
    fixtureId: clip.fixtureId,
    fixtures: clip.fixtures || (clip.fixtureId ? [clip.fixtureId] : []),
    startTime: clip.startTime || 0,
    duration: clip.duration || 1,
    effects: clip.effects || []
  }));
  
  // Convert fixtures to backend format
  const formattedFixtures = fixtures.map(f => ({
    id: f.id,
    type: f.type || 'generic',
    label: f.label || f.name
  }));
  
  const result = await validateShowProgram({
    clips: formattedClips,
    fixtures: formattedFixtures
  });
  
  const data = result.data || {};

  return {
    valid: data.valid === true,
    errors: data.errors || [],
    warnings: data.warnings || [],
    stats: data.stats || {},
    canCompile: data.valid === true && (data.stats?.totalClips || 0) > 0
  };
}

/**
 * Get program by name (utility function)
 */
/**
 * Load program from backend by ID
 */
export async function loadProgramFromBackend(programId) {
  if (!programId || typeof programId !== 'string') {
    return createApiResponse(false, null, 'Invalid program ID');
  }
  
  try {
    const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/programs/load/${programId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    
    if (!data?.program) {
      return createApiResponse(false, null, 'No program data in response');
    }
    
    // Validate the loaded data
    const validation = validateProgramData(data.program);
    if (!validation.valid) {
      return createApiResponse(false, null, validation.error);
    }
    
    return createApiResponse(true, {
      program: data.program,
      loaded_at: data.loaded_at
    }, null);
  } catch (error) {
    console.error('[API] loadProgramFromBackend failed:', error);
    return createApiResponse(false, null, error.message);
  }
}
export async function findProgramByName(name) {
  const result = await listPrograms();
  if (!result.success) {
    return createApiResponse(false, null, result.error);
  }
  
  const programs = result.data?.programs || [];
  const program = programs.find(p => p.name === name);
  if (!program) {
    return createApiResponse(false, null, `Program "${name}" not found`);
  }
  
  return loadProgramFromBackend(program.program_id);
}
/**
 * Create an autosave of current program state
 * @param {string} sessionId - Current session ID
 * @param {Object} programData - Current program data (timeline, clips, settings)
 * @param {string|null} programId - Optional program ID if loading existing
 * @param {string|null} programName - Optional program name
 * @returns {Promise<Object>} Autosave result
 */
export async function createAutosave(sessionId, programData, programId = null, programName = null) {
  if (!sessionId || typeof sessionId !== 'string') {
    return createApiResponse(false, null, 'Invalid session ID');
  }
  
  if (!programData || typeof programData !== 'object') {
    return createApiResponse(false, null, 'Invalid program data');
  }
  
  try {
    const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/autosave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        programData,
        programId,
        programName
      }),
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    
    if (!data.success) {
      throw new Error(data.error || 'Autosave failed');
    }
    
    return createApiResponse(true, {
      autosaveId: data.autosaveId,
      timestamp: data.timestamp,
      clipCount: data.clipCount,
      checksum: data.checksum,
      message: data.message
    }, null);
  } catch (error) {
    console.error('[API] Autosave failed:', error);
    return createApiResponse(false, null, error.message || 'Autosave failed');
  }
}

/**
 * Get latest autosave for recovery
 * @param {string} sessionId - Current session ID
 * @returns {Promise<Object>} Recovery data with found flag and autosave if exists
 */
export async function getRecoveryAutosave(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return createApiResponse(false, { found: false, autosave: null, autosaveCount: 0, latestTimestamp: null }, 'Invalid session ID');
  }
  
  try {
    const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/recovery?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    return createApiResponse(true, {
      found: data.found || false,
      autosave: data.autosave || null,
      autosaveCount: data.autosaveCount || 0,
      latestTimestamp: data.latestTimestamp || null
    }, null);
  } catch (error) {
    console.error('[API] Recovery check failed:', error);
    return createApiResponse(false, { found: false, autosave: null, autosaveCount: 0, latestTimestamp: null }, error.message);
  }
}

/**
 * List all autosaves (admin/debug function)
 * @param {string|null} sessionId - Optional session filter
 * @returns {Promise<Object>} List of autosaves
 */
export async function listAutosaves(sessionId = null) {
  try {
    let url = `${SHOW_PROGRAMMER_API}/autosave/list`;
    if (sessionId) {
      url += `?sessionId=${encodeURIComponent(sessionId)}`;
    }
    
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    return createApiResponse(true, {
      autosaves: data.autosaves || [],
      count: data.count || 0
    }, null);
  } catch (error) {
    console.error('[API] List autosaves failed:', error);
    return createApiResponse(false, { autosaves: [], count: 0 }, error.message);
  }
}

/**
 * Manually cleanup old autosaves
 * @returns {Promise<Object>} Cleanup result
 */
export async function cleanupAutosaves() {
  try {
    const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/autosave/cleanup`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      const errorData = await safeJsonParse(response);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }
    
    const data = await safeJsonParse(response);
    return createApiResponse(true, {
      deleted: data.deleted || 0,
      kept: data.kept || 10,
      message: data.message
    }, null);
  } catch (error) {
    console.error('[API] Autosave cleanup failed:', error);
    return createApiResponse(false, null, error.message);
  }
}

/**
 * Generate a session ID (call this when component mounts)
 * @returns {string} UUID v4 session ID
 */
export function generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function buildCompilePayload({
  timelineClips = [],
  beatMarkers = [],
  cues = [],
  audioDuration = 120,
  bpm = 128,
  deviceRegistry = {},
}) {
  return {
    timelineClips,
    beatMarkers,
    cues,
    audioDuration,
    bpm,
    deviceRegistry,
    dryRun: true,
    source: "show-programmer",
    generatedAt: new Date().toISOString(),
  };
}

export async function validateProgramBackend({
  timelineClips = [],
  fixtures = [],
  audioDuration = 120,
  program_id = null,
} = {}) {
  try {
    const response = await fetchWithTimeout(`${SHOW_PROGRAMMER_API}/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timelineClips,
        fixtures,
        audioDuration,
        program_id,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail || data?.error || "Backend validation failed.",
        data,
      };
    }

    return {
      success: true,
      error: null,
      data,
    };
  } catch (error) {
    console.error("validateProgramBackend failed:", error);
    return {
      success: false,
      error: error?.message || "Backend validation request failed.",
      data: null,
    };
  }
}

export async function autosaveProgram({
  sessionId,
  programData = {},
  programId = null,
  programName = null,
} = {}) {
  return createAutosave(sessionId, programData, programId, programName);
}
