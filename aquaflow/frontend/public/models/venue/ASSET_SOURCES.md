# AquaFlow venue model sources

These files are bundled locally so a preview does not depend on a third-party CDN.
The original model formats, materials, and embedded images remain in each GLB.

| Local files | Original creator and source | License | Notes |
| --- | --- | --- | --- |
| `person_reading.glb` | [Innerscene / MakeHuman-derived reading figure](https://www.innerscene.com/tools/library/3d-parts/reading-a-book-3d-person-everyday-tasks-c6444d5b) | CC0 | Embedded skin, clothing and hair images; 111k-triangle static figure. |
| `person_walking.glb` | [Innerscene / MakeHuman-derived walking figure](https://www.innerscene.com/tools/library/3d-parts/stepping-upward-3d-person-walking-20fd77c7) | CC0 | Embedded material images; static walking pose. |
| `female_standing.glb`, `female_walking.glb`, `male_standing.glb`, `male_standing_waving.glb` | [Quaternius Background Posed Humans](https://quaternius.com/packs/backgroundposedhumans.html), [CC0 GLB mirror](https://github.com/Papyszoo/CC0-Public-Domain-Models/tree/main/packs/quaternius-backgroundposedhumans) | CC0 | Authored meshes with colored materials and UVs, but no embedded image maps; used as lighter background crowd variants. |
| `b_small.glb`, `b_medium.glb`, `b_large.glb` | [Quaternius Downtown City MegaKit](https://quaternius.com/packs/downtowncitymegakit.html), [texture-preserving web conversions](https://github.com/anshaneja5/skyline-run/blob/main/CREDITS.md) | CC0 | Web-optimized GLBs with embedded WebP image textures. |
| `tree_common_1.glb`, `tree_common_2.glb`, `tree_common_3.glb` | [Quaternius Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html), [texture-preserving web conversions](https://github.com/anshaneja5/skyline-run/blob/main/CREDITS.md) | CC0 | CommonTree 1/2/4; textured, web-optimized GLBs with distinct authored trunks and canopies. |

Custom files imported through the 3D editor remain in the browser's local IndexedDB.
Importers should confirm they have the rights to use their own Blender exports.

## Blender import workflow

1. In Blender, use **File → Export → glTF 2.0** and select **glTF Binary (.glb)**. Include materials and image textures in the export.
2. In AquaFlow's 3D Preview, turn on **Edit mode**, open **Library → 3D Models**, and choose **Import Blender GLB…**.
3. Drag the imported model into the view. Select it in the hierarchy to set position, rotation, and size numerically, or use the move/rotate tools.

The model and its placement are stored locally in this browser, not sent to the runtime controller or uploaded to a server. Clearing browser site data removes custom model files and positions. Only self-contained glTF 2.0 GLB files up to 60 MB are accepted; external texture references and compressed extensions that require extra decoders are rejected.
