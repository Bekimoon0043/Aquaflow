// src/components/showProgrammer/ClipInspector.jsx
import React, { useState, useCallback } from 'react';

/**
 * ClipInspector — Standalone clip/effect property inspector panel
 * Props:
 *   - clip: {
 *       id, name, type, startTime, duration, 
 *       effects: [{ type, params, startTime, duration }],
 *       fixtures: [fixtureIds],
 *       color, locked, muted
 *     } | null
 *   - availableEffects: Array<{ type, label, defaultParams, paramSchema }>
 *   - availableFixtures: Array<{ id, label, type }>
 *   - onClipUpdate: (clipId, updates) => void
 *   - onEffectAdd: (clipId, effectType) => void
 *   - onEffectUpdate: (clipId, effectIndex, updates) => void
 *   - onEffectRemove: (clipId, effectIndex) => void
 *   - onFixtureToggle: (clipId, fixtureId) => void
 *   - className: string
 */
export default function ClipInspector({
  clip = null,
  availableEffects = [],
  availableFixtures = [],
  onClipUpdate,
  onEffectAdd,
  onEffectUpdate,
  onEffectRemove,
  onFixtureToggle,
  className = '',
}) {
  const [activeTab, setActiveTab] = useState('properties'); // 'properties' | 'effects' | 'fixtures'

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${m}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const handleTimeChange = useCallback((field, value) => {
    if (!clip || !onClipUpdate) return;
    const num = parseFloat(value);
    if (!isNaN(num)) {
      onClipUpdate(clip.id, { [field]: num });
    }
  }, [clip, onClipUpdate]);

  const handleEffectParamChange = useCallback((effectIndex, paramKey, value) => {
    if (!clip || !onEffectUpdate) return;
    const effect = clip.effects[effectIndex];
    let parsedValue = value;
    
    // Auto-parse numbers
    if (!isNaN(parseFloat(value)) && value !== '') {
      parsedValue = parseFloat(value);
    }
    // Auto-parse booleans
    if (value === 'true') parsedValue = true;
    if (value === 'false') parsedValue = false;
    
    const newParams = { ...effect.params, [paramKey]: parsedValue };
    onEffectUpdate(clip.id, effectIndex, { params: newParams });
  }, [clip, onEffectUpdate]);

  if (!clip) {
    return (
      <div className={`clip-inspector empty ${className}`} style={styles.container}>
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>Select a clip to inspect</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`clip-inspector ${className}`} style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.clipInfo}>
          <div 
            style={{ ...styles.colorDot, backgroundColor: clip.color || '#4a9eff' }} 
          />
          <span style={styles.clipName}>{clip.name || 'Untitled Clip'}</span>
          <span style={styles.clipType}>{clip.type}</span>
        </div>
        <div style={styles.clipControls}>
          <button 
            style={{ ...styles.iconBtn, opacity: clip.muted ? 0.5 : 1 }}
            onClick={() => onClipUpdate?.(clip.id, { muted: !clip.muted })}
            title={clip.muted ? 'Unmute' : 'Mute'}
          >
            {clip.muted ? '🔇' : '🔊'}
          </button>
          <button 
            style={{ ...styles.iconBtn, opacity: clip.locked ? 0.5 : 1 }}
            onClick={() => onClipUpdate?.(clip.id, { locked: !clip.locked })}
            title={clip.locked ? 'Unlock' : 'Lock'}
          >
            {clip.locked ? '🔒' : '🔓'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {['properties', 'effects', 'fixtures'].map(tab => (
          <button
            key={tab}
            style={{
              ...styles.tab,
              ...(activeTab === tab ? styles.tabActive : {}),
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Properties Tab */}
      {activeTab === 'properties' && (
        <div style={styles.tabContent}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Name</label>
            <input
              style={styles.input}
              value={clip.name || ''}
              onChange={(e) => onClipUpdate?.(clip.id, { name: e.target.value })}
            />
          </div>
          
          <div style={styles.fieldRow}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Start Time</label>
              <input
                style={styles.input}
                type="text"
                value={formatTime(clip.startTime || 0)}
                onChange={(e) => handleTimeChange('startTime', e.target.value)}
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Duration</label>
              <input
                style={styles.input}
                type="text"
                value={formatTime(clip.duration || 0)}
                onChange={(e) => handleTimeChange('duration', e.target.value)}
              />
            </div>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>End Time</label>
            <input
              style={styles.input}
              type="text"
              value={formatTime((clip.startTime || 0) + (clip.duration || 0))}
              readOnly
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Color</label>
            <div style={styles.colorPicker}>
              {['#4a9eff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#ff922b', '#20c997', '#ff8fab'].map(c => (
                <button
                  key={c}
                  style={{
                    ...styles.colorOption,
                    backgroundColor: c,
                    border: clip.color === c ? '2px solid #fff' : '2px solid transparent',
                  }}
                  onClick={() => onClipUpdate?.(clip.id, { color: c })}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Effects Tab */}
      {activeTab === 'effects' && (
        <div style={styles.tabContent}>
          <div style={styles.effectsList}>
            {(clip.effects || []).map((effect, index) => (
              <div key={index} style={styles.effectCard}>
                <div style={styles.effectHeader}>
                  <span style={styles.effectType}>{effect.type}</span>
                  <button 
                    style={styles.removeBtn}
                    onClick={() => onEffectRemove?.(clip.id, index)}
                  >
                    ✕
                  </button>
                </div>
                
                <div style={styles.effectTiming}>
                  <span>@{formatTime(effect.startTime || 0)} for {formatTime(effect.duration || 0)}</span>
                </div>

                {/* Effect Parameters */}
                <div style={styles.effectParams}>
                  {Object.entries(effect.params || {}).map(([key, value]) => {
                    const schema = availableEffects.find(e => e.type === effect.type)?.paramSchema?.[key];
                    return (
                      <div key={key} style={styles.paramField}>
                        <label style={styles.paramLabel}>{schema?.label || key}</label>
                        {schema?.type === 'select' ? (
                          <select
                            style={styles.input}
                            value={value}
                            onChange={(e) => handleEffectParamChange(index, key, e.target.value)}
                          >
                            {schema.options.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : schema?.type === 'boolean' ? (
                          <button
                            style={{ ...styles.toggleBtn, backgroundColor: value ? '#51cf66' : '#333' }}
                            onClick={() => handleEffectParamChange(index, key, !value)}
                          >
                            {value ? 'ON' : 'OFF'}
                          </button>
                        ) : (
                          <input
                            style={styles.input}
                            type={schema?.type === 'number' ? 'number' : 'text'}
                            value={value}
                            step={schema?.step || 0.1}
                            min={schema?.min}
                            max={schema?.max}
                            onChange={(e) => handleEffectParamChange(index, key, e.target.value)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Add Effect */}
          <div style={styles.addEffectSection}>
            <label style={styles.label}>Add Effect</label>
            <div style={styles.effectButtons}>
              {availableEffects.map(effect => (
                <button
                  key={effect.type}
                  style={styles.effectAddBtn}
                  onClick={() => onEffectAdd?.(clip.id, effect.type)}
                >
                  + {effect.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Fixtures Tab */}
      {activeTab === 'fixtures' && (
        <div style={styles.tabContent}>
          <div style={styles.fixtureList}>
            {availableFixtures.map(fixture => {
              const isAssigned = (clip.fixtures || []).includes(fixture.id);
              return (
                <div 
                  key={fixture.id} 
                  style={{
                    ...styles.fixtureItem,
                    backgroundColor: isAssigned ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
                  }}
                  onClick={() => onFixtureToggle?.(clip.id, fixture.id)}
                >
                  <div style={styles.fixtureCheckbox}>
                    {isAssigned ? '☑' : '☐'}
                  </div>
                  <div style={styles.fixtureInfo}>
                    <span style={styles.fixtureLabel}>{fixture.label}</span>
                    <span style={styles.fixtureType}>{fixture.type}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline styles (no external CSS dependency)
const styles = {
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
    overflow: 'hidden',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '40px',
  },
  emptyText: {
    color: '#666',
    fontSize: '14px',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid #2a2a4e',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clipInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  colorDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  clipName: {
    fontWeight: '600',
    fontSize: '14px',
  },
  clipType: {
    fontSize: '11px',
    color: '#888',
    backgroundColor: '#2a2a4e',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  clipControls: {
    display: 'flex',
    gap: '4px',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#e0e0e0',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #2a2a4e',
  },
  tab: {
    flex: 1,
    padding: '10px',
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tabActive: {
    color: '#4a9eff',
    borderBottom: '2px solid #4a9eff',
    backgroundColor: 'rgba(74, 158, 255, 0.1)',
  },
  tabContent: {
    padding: '16px',
    overflowY: 'auto',
    flex: 1,
  },
  fieldGroup: {
    marginBottom: '12px',
  },
  fieldRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
  },
  label: {
    display: 'block',
    fontSize: '11px',
    color: '#888',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    backgroundColor: '#0f0f1a',
    border: '1px solid #2a2a4e',
    borderRadius: '4px',
    color: '#e0e0e0',
    fontSize: '13px',
    boxSizing: 'border-box',
  },
  colorPicker: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  colorOption: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    cursor: 'pointer',
    padding: 0,
  },
  effectsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  effectCard: {
    backgroundColor: '#0f0f1a',
    border: '1px solid #2a2a4e',
    borderRadius: '6px',
    padding: '10px',
  },
  effectHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px',
  },
  effectType: {
    fontWeight: '600',
    fontSize: '13px',
    color: '#4a9eff',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: '#ff6b6b',
    cursor: 'pointer',
    fontSize: '12px',
  },
  effectTiming: {
    fontSize: '11px',
    color: '#666',
    marginBottom: '8px',
  },
  effectParams: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  paramField: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  paramLabel: {
    fontSize: '11px',
    color: '#888',
    flexShrink: 0,
  },
  toggleBtn: {
    padding: '4px 12px',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: '600',
  },
  addEffectSection: {
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px solid #2a2a4e',
  },
  effectButtons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '8px',
  },
  effectAddBtn: {
    padding: '6px 12px',
    backgroundColor: '#2a2a4e',
    border: '1px solid #3a3a5e',
    borderRadius: '4px',
    color: '#e0e0e0',
    fontSize: '12px',
    cursor: 'pointer',
  },
  fixtureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  fixtureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  fixtureCheckbox: {
    fontSize: '16px',
    color: '#4a9eff',
  },
  fixtureInfo: {
    display: 'flex',
    flexDirection: 'column',
  },
  fixtureLabel: {
    fontSize: '13px',
  },
  fixtureType: {
    fontSize: '11px',
    color: '#666',
  },
};