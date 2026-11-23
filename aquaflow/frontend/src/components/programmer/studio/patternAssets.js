import bellagioTiesto from '../../../assets/patterns/bellagioTiesto';
import { PATTERN_FILE_FORMAT } from './showBlocks';

export const PATTERN_ASSET_DRAG_MIME = 'application/x-aquaflow-pattern-asset';
export const PATTERN_ASSET_PACKS = Object.freeze([bellagioTiesto]);
export const PATTERN_ASSETS = Object.freeze(PATTERN_ASSET_PACKS.flatMap(pack => pack.patterns.map(asset => ({ ...asset, packId: pack.id, packName: pack.name }))));

export function patternAssetById(id) {
  return PATTERN_ASSETS.find(asset => asset.id === id) || null;
}

export function patternAssetFile(asset) {
  return { format: PATTERN_FILE_FORMAT, version: 1, patterns: [asset] };
}

export function patternAssetCategories(assets = PATTERN_ASSETS) {
  return [...new Set(assets.map(asset => asset.category).filter(Boolean))].sort();
}
