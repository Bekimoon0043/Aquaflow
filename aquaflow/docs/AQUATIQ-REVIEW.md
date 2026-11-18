# AquaTiq review and the independent AquaFlow decision

## What was inspected

### AquaTiq 1.1.1

The supplied v1.1.1 folder is a standalone Blender addon. Its Python entry point is GPL-licensed and registers preferences, operators, materials and UI. Assets are organized as:

- `blends/assets/effects/` — jets, spray, splashes, mist and streams.
- `blends/assets/fountains/` — complete fountain models.
- `blends/assets/modular/` — modular water effects.
- `blends/materials/water/` — the waterial water-material library.
- `sequences/` — animated mask and normal-map sequences.

The vertical jet is a mesh plane approximately 3.13 m high with a 30-frame sequence. Mask and normal images are stored as Blender `SEQUENCE` sources. The collection is linked and instanced, which makes the effect cheap to reuse. The water shader is a substantial node group with mapping, transparency, glossy/glass layers, volume absorption/scattering and animation-aware textures.

### AquaTiq 2.0.0

The v2 file is a ZIP-format `.paq` asset pack, not a conventional Python addon. It contains `aquatiq_full.pack-info`, a `mapr_index.json`, Blender asset-catalog definitions, `.blend` models/materials, textures and animation sequences. It is intended for engon and/or Blender's native asset browser. Effects moved to `blends/models/effects/`.

Official material describes animated planes, procedural assets, 30-frame loops, layering, mask painting, fountains, water materials, and rain/river/puddle generators ([AquaTiq product page](https://blendermarket.com/products/aquatiq-water-library), [official documentation](https://docs.polygoniq.com/aquatiq/latest/)).

## Useful techniques

- Animated masks and normal maps are much cheaper than simulating every droplet.
- Multiple layers can suggest volume without a full 3D fluid solve.
- Consistent materials make separately created effects read as one scene.
- Linked collection instances keep memory use low.
- Real fixture lighting should illuminate the water effect; a texture alone is not a lighting solution.

These are techniques, not permission to copy the proprietary assets.

## License constraint

AquaTiq's official FAQ says renders and animations may be distributed, but the asset files themselves may not be redistributed, including embedding them in `.blend` files supplied to clients ([AquaTiq FAQ](https://docs.polygoniq.com/aquatiq/2.0.0/troubleshooting/faq/)). The same FAQ allows one user to install on multiple computers, but other users need their own licenses.

AquaFlow can read the supplied `.blend` effects and materials directly without installing AquaTiq or engon. Third-party files remain external and are not included in the addon ZIP or packed into saved scenes. Each machine needs those files and the appropriate license. The addon's original generated fallback remains available when external assets are disabled.

## Independent implementation

AquaFlow instead generates original deterministic assets in `aquaflow_studio/procedural_textures.py`:

- 30-frame clear and aerated mask sequences.
- Normal maps calculated from those masks.
- Original droplet placement, coherent core, filament breakup and deterministic motion.
- UV-mapped crossed sheets created by `procedural_water.py` and shaded with transparent/Principled materials.

The original sequences ship inside the addon folder because Blender does not pack image sequences. Supplied third-party effects and materials always remain external. The original sequence is the no-download fallback when external assets are disabled.

These animated sheets are **design proxies**, not a claim of fluid dynamics. Mantaflow remains the native-liquid path, with true-radius inflows, basin collision and overflow/runoff control.
