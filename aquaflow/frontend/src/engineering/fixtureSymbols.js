/**
 * fixtureSymbols.js — Standard engineering drawing symbols
 * 
 * Each symbol defines:
 * - type: equipment type identifier
 * - label: display name
 * - shape: circle, square, diamond, triangle, cross, nozzle, light
 * - color: default color
 * - size: default size in pixels
 * - rotationOffset: default rotation offset (degrees)
 */

export const FIXTURE_SYMBOLS = {
  // Water Nozzles
  nozzle: {
    type: 'nozzle',
    label: 'Nozzle',
    shape: 'circle',
    color: '#3b82f6',
    size: 14,
    rotationOffset: 0,
  },
  nozzle_geyser: {
    type: 'nozzle_geyser',
    label: 'Geyser',
    shape: 'triangle',
    color: '#06b6d4',
    size: 16,
    rotationOffset: 0,
  },
  nozzle_arch: {
    type: 'nozzle_arch',
    label: 'Arch',
    shape: 'arc',
    color: '#3b82f6',
    size: 16,
    rotationOffset: 0,
  },
  nozzle_cascade: {
    type: 'nozzle_cascade',
    label: 'Cascade',
    shape: 'wave',
    color: '#3b82f6',
    size: 16,
    rotationOffset: 0,
  },
  nozzle_ring: {
    type: 'nozzle_ring',
    label: 'Ring',
    shape: 'ring',
    color: '#3b82f6',
    size: 14,
    rotationOffset: 0,
  },
  nozzle_mist: {
    type: 'nozzle_mist',
    label: 'Mist',
    shape: 'dots',
    color: '#94a3b8',
    size: 12,
    rotationOffset: 0,
  },
  nozzle_fan: {
    type: 'nozzle_fan',
    label: 'Fan Jet',
    shape: 'fan',
    color: '#3b82f6',
    size: 16,
    rotationOffset: 0,
  },

  // Motion Nozzles
  motion_1d: {
    type: 'motion_1d',
    label: 'Motion 1D',
    shape: 'motion_1d',
    color: '#8b5cf6',
    size: 18,
    rotationOffset: 0,
  },
  motion_2d: {
    type: 'motion_2d',
    label: 'Motion 2D',
    shape: 'motion_2d',
    color: '#a78bfa',
    size: 18,
    rotationOffset: 0,
  },
  motion_3d: {
    type: 'motion_3d',
    label: 'Motion 3D',
    shape: 'motion_3d',
    color: '#c084fc',
    size: 20,
    rotationOffset: 0,
  },

  // Lighting
  light_rgb: {
    type: 'light_rgb',
    label: 'RGB Light',
    shape: 'light_rgb',
    color: '#f59e0b',
    size: 14,
    rotationOffset: 0,
  },
  light_rgbw: {
    type: 'light_rgbw',
    label: 'RGBW Light',
    shape: 'light_rgbw',
    color: '#fbbf24',
    size: 16,
    rotationOffset: 0,
  },
  light_spot: {
    type: 'light_spot',
    label: 'Spot Light',
    shape: 'light_spot',
    color: '#f59e0b',
    size: 14,
    rotationOffset: 0,
  },
  light_ring: {
    type: 'light_ring',
    label: 'Ring Light',
    shape: 'light_ring',
    color: '#f59e0b',
    size: 14,
    rotationOffset: 0,
  },

  // Pumps and VFD
  pump: {
    type: 'pump',
    label: 'Pump',
    shape: 'pump',
    color: '#ef4444',
    size: 20,
    rotationOffset: 0,
  },
  vfd: {
    type: 'vfd',
    label: 'VFD',
    shape: 'vfd',
    color: '#ef4444',
    size: 18,
    rotationOffset: 0,
  },

  // Valves and Solenoids
  valve: {
    type: 'valve',
    label: 'Valve',
    shape: 'valve',
    color: '#8b5cf6',
    size: 14,
    rotationOffset: 0,
  },
  solenoid: {
    type: 'solenoid',
    label: 'Solenoid',
    shape: 'solenoid',
    color: '#a78bfa',
    size: 14,
    rotationOffset: 0,
  },

  // Plumbing Connections
  drain: {
    type: 'drain',
    label: 'Drain',
    shape: 'drain',
    color: '#64748b',
    size: 14,
    rotationOffset: 0,
  },
  return_inlet: {
    type: 'return_inlet',
    label: 'Return Inlet',
    shape: 'return',
    color: '#3b82f6',
    size: 14,
    rotationOffset: 0,
  },
  suction_outlet: {
    type: 'suction_outlet',
    label: 'Suction Outlet',
    shape: 'suction',
    color: '#ef4444',
    size: 14,
    rotationOffset: 0,
  },

  // Effect Nozzles
  fire_nozzle: {
    type: 'fire_nozzle',
    label: 'Fire Nozzle',
    shape: 'fire',
    color: '#f97316',
    size: 14,
    rotationOffset: 0,
  },
  fog_nozzle: {
    type: 'fog_nozzle',
    label: 'Fog Nozzle',
    shape: 'fog',
    color: '#94a3b8',
    size: 14,
    rotationOffset: 0,
  },

  // Generic fallback
  generic: {
    type: 'generic',
    label: 'Equipment',
    shape: 'square',
    color: '#6b7280',
    size: 12,
    rotationOffset: 0,
  },
};

/**
 * Get symbol definition for a fixture type
 * @param {string} type - Fixture type string
 * @returns {Object} Symbol definition
 */
export function getSymbolForType(type) {
  const key = String(type || '').toLowerCase();
  
  // Direct match
  if (FIXTURE_SYMBOLS[key]) {
    return FIXTURE_SYMBOLS[key];
  }
  
  // Nozzle family
  if (key.includes('geyser')) return FIXTURE_SYMBOLS.nozzle_geyser;
  if (key.includes('arch')) return FIXTURE_SYMBOLS.nozzle_arch;
  if (key.includes('cascade')) return FIXTURE_SYMBOLS.nozzle_cascade;
  if (key.includes('ring')) return FIXTURE_SYMBOLS.nozzle_ring;
  if (key.includes('mist')) return FIXTURE_SYMBOLS.nozzle_mist;
  if (key.includes('fan')) return FIXTURE_SYMBOLS.nozzle_fan;
  
  // Motion nozzles
  if (key.includes('motion_3d') || key.includes('3d')) return FIXTURE_SYMBOLS.motion_3d;
  if (key.includes('motion_2d') || key.includes('2d')) return FIXTURE_SYMBOLS.motion_2d;
  if (key.includes('motion')) return FIXTURE_SYMBOLS.motion_1d;
  
  // Lighting
  if (key.includes('rgbw')) return FIXTURE_SYMBOLS.light_rgbw;
  if (key.includes('rgb') || key.includes('color')) return FIXTURE_SYMBOLS.light_rgb;
  if (key.includes('spot')) return FIXTURE_SYMBOLS.light_spot;
  if (key.includes('ring') && key.includes('light')) return FIXTURE_SYMBOLS.light_ring;
  if (key.includes('light')) return FIXTURE_SYMBOLS.light_rgb;
  
  // Pumps
  if (key.includes('pump')) return FIXTURE_SYMBOLS.pump;
  if (key.includes('vfd')) return FIXTURE_SYMBOLS.vfd;
  
  // Valves
  if (key.includes('valve')) return FIXTURE_SYMBOLS.valve;
  if (key.includes('solenoid')) return FIXTURE_SYMBOLS.solenoid;
  
  // Plumbing
  if (key.includes('drain')) return FIXTURE_SYMBOLS.drain;
  if (key.includes('return')) return FIXTURE_SYMBOLS.return_inlet;
  if (key.includes('suction')) return FIXTURE_SYMBOLS.suction_outlet;
  
  // Effects
  if (key.includes('fire') || key.includes('flame')) return FIXTURE_SYMBOLS.fire_nozzle;
  if (key.includes('fog')) return FIXTURE_SYMBOLS.fog_nozzle;
  
  // Generic nozzle
  if (key.includes('nozzle') || key.includes('jet')) return FIXTURE_SYMBOLS.nozzle;
  
  return FIXTURE_SYMBOLS.generic;
}

/**
 * Draw a symbol on canvas context
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} symbol - Symbol definition
 * @param {number} x - X position (center)
 * @param {number} y - Y position (center)
 * @param {number} rotation - Rotation in degrees
 * @param {number} scale - Scale factor (default 1)
 * @param {boolean} selected - Whether fixture is selected
 */
export function drawSymbol(ctx, symbol, x, y, rotation = 0, scale = 1, selected = false) {
  if (!ctx) return;
  
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotation * Math.PI) / 180);
  
  const size = (symbol.size || 12) * scale;
  const color = selected ? '#ff4444' : (symbol.color || '#6b7280');
  const halfSize = size / 2;
  
  ctx.beginPath();
  
  switch (symbol.shape) {
    case 'circle':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, halfSize * 0.3, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      break;
      
    case 'square':
      ctx.rect(-halfSize, -halfSize, size, size);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      break;
      
    case 'diamond':
      ctx.moveTo(0, -halfSize);
      ctx.lineTo(halfSize, 0);
      ctx.lineTo(0, halfSize);
      ctx.lineTo(-halfSize, 0);
      ctx.closePath();
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      break;
      
    case 'triangle':
      ctx.moveTo(0, -halfSize);
      ctx.lineTo(halfSize, halfSize);
      ctx.lineTo(-halfSize, halfSize);
      ctx.closePath();
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      break;
      
    case 'nozzle':
      ctx.moveTo(0, -halfSize);
      ctx.lineTo(halfSize * 0.7, halfSize * 0.5);
      ctx.lineTo(-halfSize * 0.7, halfSize * 0.5);
      ctx.closePath();
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -halfSize * 0.8);
      ctx.lineTo(2, -halfSize * 0.4);
      ctx.lineTo(-2, -halfSize * 0.4);
      ctx.fillStyle = color;
      ctx.fill();
      break;
      
    case 'light_rgb':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-halfSize * 0.4, -halfSize * 0.3, halfSize * 0.2, 0, 2 * Math.PI);
      ctx.fillStyle = '#ff4444';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -halfSize * 0.4, halfSize * 0.2, 0, 2 * Math.PI);
      ctx.fillStyle = '#44ff44';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(halfSize * 0.4, -halfSize * 0.3, halfSize * 0.2, 0, 2 * Math.PI);
      ctx.fillStyle = '#4444ff';
      ctx.fill();
      break;
      
    case 'light_rgbw':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      const offsets = [-halfSize * 0.35, -halfSize * 0.12, halfSize * 0.12, halfSize * 0.35];
      const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffffff'];
      offsets.forEach((off, idx) => {
        ctx.beginPath();
        ctx.arc(off, -halfSize * 0.25, halfSize * 0.12, 0, 2 * Math.PI);
        ctx.fillStyle = colors[idx];
        ctx.fill();
      });
      break;
      
    case 'light_spot':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -halfSize * 0.7);
      ctx.lineTo(4, -halfSize * 0.2);
      ctx.lineTo(-4, -halfSize * 0.2);
      ctx.fillStyle = color;
      ctx.fill();
      break;
      
    case 'light_ring':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, halfSize * 0.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#0f1722';
      ctx.fill();
      break;
      
    case 'pump':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.font = `${size * 0.6}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', 0, 0);
      break;
      
    case 'vfd':
      ctx.rect(-halfSize, -halfSize, size, size);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.font = `${size * 0.5}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('V', 0, 0);
      break;
      
    case 'valve':
      ctx.moveTo(0, -halfSize);
      ctx.lineTo(halfSize, 0);
      ctx.lineTo(0, halfSize);
      ctx.lineTo(-halfSize, 0);
      ctx.closePath();
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-halfSize * 0.5, -halfSize * 0.5);
      ctx.lineTo(halfSize * 0.5, halfSize * 0.5);
      ctx.stroke();
      break;
      
    case 'solenoid':
      ctx.rect(-halfSize, -halfSize * 0.6, size, size * 0.8);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-halfSize * 0.5, i * halfSize * 0.3);
        ctx.lineTo(halfSize * 0.5, i * halfSize * 0.3);
        ctx.stroke();
      }
      break;
      
    case 'drain':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-halfSize * 0.6, -halfSize * 0.6);
      ctx.lineTo(halfSize * 0.6, halfSize * 0.6);
      ctx.moveTo(halfSize * 0.6, -halfSize * 0.6);
      ctx.lineTo(-halfSize * 0.6, halfSize * 0.6);
      ctx.stroke();
      break;
      
    case 'return':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -halfSize * 0.5);
      ctx.lineTo(-halfSize * 0.4, -halfSize * 0.1);
      ctx.lineTo(halfSize * 0.4, -halfSize * 0.1);
      ctx.fill();
      break;
      
    case 'suction':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, halfSize * 0.5);
      ctx.lineTo(-halfSize * 0.4, halfSize * 0.1);
      ctx.lineTo(halfSize * 0.4, halfSize * 0.1);
      ctx.fill();
      break;
      
    case 'fire':
      ctx.moveTo(0, -halfSize);
      ctx.lineTo(halfSize * 0.5, -halfSize * 0.2);
      ctx.lineTo(halfSize * 0.2, halfSize * 0.2);
      ctx.lineTo(0, halfSize);
      ctx.lineTo(-halfSize * 0.2, halfSize * 0.2);
      ctx.lineTo(-halfSize * 0.5, -halfSize * 0.2);
      ctx.closePath();
      ctx.fillStyle = color + '44';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      break;
      
    case 'fog':
      ctx.arc(-halfSize * 0.3, -halfSize * 0.2, halfSize * 0.4, 0, 2 * Math.PI);
      ctx.arc(halfSize * 0.3, -halfSize * 0.2, halfSize * 0.4, 0, 2 * Math.PI);
      ctx.arc(0, halfSize * 0.2, halfSize * 0.35, 0, 2 * Math.PI);
      ctx.fillStyle = color + '44';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      break;
      
    case 'motion_1d':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, halfSize * 0.6, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(halfSize * 0.5, -halfSize * 0.3);
      ctx.lineTo(halfSize * 0.7, 0);
      ctx.lineTo(halfSize * 0.5, halfSize * 0.3);
      ctx.fill();
      break;
      
    case 'motion_2d':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-halfSize * 0.5, 0);
      ctx.lineTo(halfSize * 0.5, 0);
      ctx.moveTo(0, -halfSize * 0.5);
      ctx.lineTo(0, halfSize * 0.5);
      ctx.stroke();
      break;
      
    case 'motion_3d':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.font = `${size * 0.5}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('3D', 0, 0);
      break;
      
    case 'arc':
      ctx.beginPath();
      ctx.arc(0, halfSize * 0.3, halfSize * 0.7, Math.PI, 0, true);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, halfSize * 0.3, halfSize * 0.7, 0, Math.PI, false);
      ctx.stroke();
      break;
      
    case 'wave':
      ctx.beginPath();
      ctx.moveTo(-halfSize, -halfSize * 0.3);
      for (let x = -halfSize; x <= halfSize; x += halfSize * 0.25) {
        const y = -halfSize * 0.1 + Math.sin(x * 0.8) * halfSize * 0.2;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
      
    case 'ring':
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, halfSize * 0.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#0f1722';
      ctx.fill();
      break;
      
    case 'dots':
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          if (i === 0 && j === 0) continue;
          ctx.beginPath();
          ctx.arc(i * halfSize * 0.5, j * halfSize * 0.5, halfSize * 0.15, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
      break;
      
    case 'fan':
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, halfSize, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = color + '44';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      for (let a = -60; a <= 60; a += 30) {
        const rad = (a * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(rad) * halfSize, Math.sin(rad) * halfSize);
        ctx.stroke();
      }
      break;
      
    default:
      ctx.arc(0, 0, halfSize, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.font = `${size * 0.5}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbol.label.charAt(0), 0, 0);
      break;
  }
  
  ctx.restore();
}

export default {
  FIXTURE_SYMBOLS,
  getSymbolForType,
  drawSymbol,
};