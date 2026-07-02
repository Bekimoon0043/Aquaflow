// src/components/showProgrammer/AIChoreographyPanel.jsx
import React, { useState, useCallback, useRef } from 'react';

/**
 * AIChoreographyPanel — Standalone AI choreography generation panel
 * Props:
 *   - audioFeatures: { bpm, key, energy, segments: [{ start, end, loudness }] } | null
 *   - currentClips: Array<{ id, startTime, duration, type, fixtures }>
 *   - availableFixtures: Array<{ id, type, x, y }>
 *   - onGenerateChoreography: (prompt, options) => Promise<{ clips, effects }>
 *   - onApplySuggestion: (clips) => void
 *   - onPreviewSuggestion: (clips) => void
 *   - apiEndpoint: string (default '/api/show-programmer/ai-choreograph')
 *   - className: string
 */
export default function AIChoreographyPanel({
  audioFeatures = null,
  currentClips = [],
  availableFixtures = [],
  onGenerateChoreography,
  onApplySuggestion,
  onPreviewSuggestion,
  apiEndpoint = '/api/show-programmer/ai-choreograph',
  className = '',
}) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  const [error, setError] = useState(null);
  const [options, setOptions] = useState({
    intensity: 'medium',      // 'subtle' | 'medium' | 'intense' | 'extreme'
    style: 'synchronized',    // 'synchronized' | 'wave' | 'random' | 'symmetric'
    maxSimultaneous: 8,
    useAllFixtures: true,
    matchBeats: true,
    matchDynamics: true,
    includeLights: true,
    includeWater: true,
    duration: audioFeatures ? Math.ceil(audioFeatures.duration || 60) : 60,
  });

  const abortRef = useRef(null);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && !audioFeatures) {
      setError('Please provide a prompt or load audio first');
      return;
    }
    
    setIsGenerating(true);
    setError(null);
    setSuggestions([]);
    setSelectedSuggestion(null);

    try {
      let result;
      
      if (onGenerateChoreography) {
        // Use provided callback
        result = await onGenerateChoreography(prompt, {
          ...options,
          audioFeatures,
          currentClips,
          availableFixtures,
        });
      } else {
        // Use API endpoint directly
        const controller = new AbortController();
        abortRef.current = controller;
        
        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            options: {
              ...options,
              audioFeatures,
              currentClips,
              availableFixtures: availableFixtures.map(f => ({
                id: f.id,
                type: f.type,
                x: f.x,
                y: f.y,
              })),
            },
          }),
          signal: controller.signal,
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result = await response.json();
      }

      if (result.suggestions) {
        setSuggestions(result.suggestions);
      } else if (result.clips) {
        setSuggestions([{ clips: result.clips, description: result.description || 'Generated choreography' }]);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Generation failed');
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [prompt, options, audioFeatures, currentClips, availableFixtures, onGenerateChoreography, apiEndpoint]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsGenerating(false);
  }, []);

  const handlePreview = useCallback((suggestion) => {
    setSelectedSuggestion(suggestion);
    if (onPreviewSuggestion && suggestion.clips) {
      onPreviewSuggestion(suggestion.clips);
    }
  }, [onPreviewSuggestion]);

  const handleApply = useCallback(() => {
    if (selectedSuggestion?.clips && onApplySuggestion) {
      onApplySuggestion(selectedSuggestion.clips);
    }
  }, [selectedSuggestion, onApplySuggestion]);

  const updateOption = useCallback((key, value) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  }, []);

  const presetPrompts = [
    'Build a dramatic opening with all jets firing in sequence',
    'Create a gentle wave pattern across the fountain',
    'Synchronize everything to the beat drops',
    'Build tension with low mist, then explode into geysers',
    'Rainbow color chase from left to right',
    'Alternating rings — inner then outer, building intensity',
    'Laminar arcs forming a tunnel effect',
    'Volcano eruption followed by calming cascade',
  ];

  return (
    <div className={`ai-choreography-panel ${className}`} style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.title}>🤖 AI Choreography</h3>
        {audioFeatures && (
          <div style={styles.audioBadge}>
            🎵 {Math.round(audioFeatures.bpm || 0)} BPM | {audioFeatures.key || '?'}
          </div>
        )}
      </div>

      {/* Prompt Input */}
      <div style={styles.promptSection}>
        <textarea
          style={styles.promptInput}
          placeholder="Describe the choreography you want... (e.g., 'Build a dramatic crescendo with all jets, then fade to gentle mist')"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
        
        {/* Quick Presets */}
        <div style={styles.presets}>
          {presetPrompts.map((p, i) => (
            <button
              key={i}
              style={styles.presetBtn}
              onClick={() => setPrompt(p)}
            >
              {p.length > 40 ? p.slice(0, 40) + '...' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Options */}
      <div style={styles.optionsSection}>
        <div style={styles.optionRow}>
          <label style={styles.optionLabel}>Intensity</label>
          <select 
            style={styles.select}
            value={options.intensity}
            onChange={(e) => updateOption('intensity', e.target.value)}
          >
            <option value="subtle">Subtle</option>
            <option value="medium">Medium</option>
            <option value="intense">Intense</option>
            <option value="extreme">Extreme</option>
          </select>
        </div>

        <div style={styles.optionRow}>
          <label style={styles.optionLabel}>Style</label>
          <select 
            style={styles.select}
            value={options.style}
            onChange={(e) => updateOption('style', e.target.value)}
          >
            <option value="synchronized">Synchronized</option>
            <option value="wave">Wave</option>
            <option value="random">Random</option>
            <option value="symmetric">Symmetric</option>
            <option value="cascade">Cascade</option>
          </select>
        </div>

        <div style={styles.optionRow}>
          <label style={styles.optionLabel}>Max Simultaneous</label>
          <input
            style={{ ...styles.input, width: '60px' }}
            type="number"
            min={1}
            max={50}
            value={options.maxSimultaneous}
            onChange={(e) => updateOption('maxSimultaneous', parseInt(e.target.value))}
          />
        </div>

        <div style={styles.togglesRow}>
          {[
            { key: 'matchBeats', label: 'Match Beats' },
            { key: 'matchDynamics', label: 'Match Dynamics' },
            { key: 'useAllFixtures', label: 'Use All Fixtures' },
            { key: 'includeLights', label: 'Include Lights' },
            { key: 'includeWater', label: 'Include Water' },
          ].map(({ key, label }) => (
            <label key={key} style={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => updateOption(key, e.target.checked)}
              />
              <span style={styles.toggleText}>{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Generate Button */}
      <div style={styles.generateSection}>
        <button
          style={{
            ...styles.generateBtn,
            ...(isGenerating ? styles.generateBtnLoading : {}),
          }}
          onClick={isGenerating ? handleCancel : handleGenerate}
          disabled={!prompt.trim() && !audioFeatures}
        >
          {isGenerating ? (
            <>
              <span style={styles.spinner}>◐</span> Generating...
            </>
          ) : (
            '✨ Generate Choreography'
          )}
        </button>
        {isGenerating && (
          <button style={styles.cancelBtn} onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={styles.error}>
          ⚠️ {error}
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div style={styles.suggestionsSection}>
          <h4 style={styles.suggestionsTitle}>Suggestions ({suggestions.length})</h4>
          
          <div style={styles.suggestionsList}>
            {suggestions.map((suggestion, index) => (
              <div
                key={index}
                style={{
                  ...styles.suggestionCard,
                  ...(selectedSuggestion === suggestion ? styles.suggestionCardActive : {}),
                }}
                onClick={() => handlePreview(suggestion)}
              >
                <div style={styles.suggestionHeader}>
                  <span style={styles.suggestionNum}>#{index + 1}</span>
                  <span style={styles.suggestionDesc}>{suggestion.description || `Choreography ${index + 1}`}</span>
                </div>
                
                {suggestion.clips && (
                  <div style={styles.suggestionStats}>
                    <span>{suggestion.clips.length} clips</span>
                    <span>{suggestion.clips.reduce((sum, c) => sum + (c.fixtures?.length || 0), 0)} fixture assignments</span>
                    <span>{formatDuration(suggestion.clips)} total</span>
                  </div>
                )}

                {suggestion.clips && (
                  <div style={styles.clipPreview}>
                    {suggestion.clips.slice(0, 5).map((clip, ci) => (
                      <div
                        key={ci}
                        style={{
                          ...styles.miniClip,
                          backgroundColor: clip.color || '#4a9eff',
                          width: `${Math.max((clip.duration || 1) * 2, 20)}px`,
                        }}
                        title={`${clip.name || clip.type} @ ${formatTime(clip.startTime)}`}
                      />
                    ))}
                    {suggestion.clips.length > 5 && (
                      <span style={styles.moreClips}>+{suggestion.clips.length - 5}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Apply Button */}
          {selectedSuggestion && (
            <button style={styles.applyBtn} onClick={handleApply}>
              ✅ Apply Selected Choreography
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDuration(clips) {
  if (!clips || clips.length === 0) return '0:00';
  const max = Math.max(...clips.map(c => (c.startTime || 0) + (c.duration || 0)));
  return formatTime(max);
}

const styles = {
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxHeight: '100%',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #2a2a4e',
    paddingBottom: '12px',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
  },
  audioBadge: {
    fontSize: '11px',
    color: '#51cf66',
    backgroundColor: 'rgba(81, 207, 102, 0.1)',
    padding: '4px 10px',
    borderRadius: '12px',
  },
  promptSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  promptInput: {
    width: '100%',
    padding: '10px',
    backgroundColor: '#0f0f1a',
    border: '1px solid #2a2a4e',
    borderRadius: '6px',
    color: '#e0e0e0',
    fontSize: '13px',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  presetBtn: {
    padding: '4px 10px',
    backgroundColor: '#2a2a4e',
    border: '1px solid #3a3a5e',
    borderRadius: '12px',
    color: '#aaa',
    fontSize: '11px',
    cursor: 'pointer',
    maxWidth: '200px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px',
    backgroundColor: '#0f0f1a',
    borderRadius: '6px',
  },
  optionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionLabel: {
    fontSize: '12px',
    color: '#888',
  },
  select: {
    padding: '6px 10px',
    backgroundColor: '#1a1a2e',
    border: '1px solid #2a2a4e',
    borderRadius: '4px',
    color: '#e0e0e0',
    fontSize: '12px',
  },
  input: {
    padding: '6px 10px',
    backgroundColor: '#1a1a2e',
    border: '1px solid #2a2a4e',
    borderRadius: '4px',
    color: '#e0e0e0',
    fontSize: '12px',
  },
  togglesRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    marginTop: '4px',
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#aaa',
    cursor: 'pointer',
  },
  toggleText: {
    userSelect: 'none',
  },
  generateSection: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  generateBtn: {
    flex: 1,
    padding: '12px',
    backgroundColor: '#4a9eff',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  generateBtnLoading: {
    backgroundColor: '#2a5a8f',
  },
  spinner: {
    animation: 'spin 1s linear infinite',
    display: 'inline-block',
  },
  cancelBtn: {
    padding: '12px 16px',
    backgroundColor: '#ff6b6b',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    cursor: 'pointer',
  },
  error: {
    padding: '10px',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    border: '1px solid #ff6b6b',
    borderRadius: '6px',
    color: '#ff6b6b',
    fontSize: '13px',
  },
  suggestionsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  suggestionsTitle: {
    margin: 0,
    fontSize: '14px',
    color: '#888',
  },
  suggestionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  suggestionCard: {
    padding: '12px',
    backgroundColor: '#0f0f1a',
    border: '1px solid #2a2a4e',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  suggestionCardActive: {
    borderColor: '#4a9eff',
    backgroundColor: 'rgba(74, 158, 255, 0.1)',
  },
  suggestionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  suggestionNum: {
    fontSize: '11px',
    color: '#4a9eff',
    fontWeight: '600',
    backgroundColor: 'rgba(74, 158, 255, 0.2)',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  suggestionDesc: {
    fontSize: '13px',
    fontWeight: '500',
  },
  suggestionStats: {
    display: 'flex',
    gap: '12px',
    fontSize: '11px',
    color: '#666',
    marginBottom: '8px',
  },
  clipPreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    height: '20px',
    overflow: 'hidden',
  },
  miniClip: {
    height: '100%',
    borderRadius: '2px',
    opacity: 0.8,
    flexShrink: 0,
  },
  moreClips: {
    fontSize: '10px',
    color: '#666',
    marginLeft: '4px',
  },
  applyBtn: {
    padding: '12px',
    backgroundColor: '#51cf66',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '8px',
  },
};