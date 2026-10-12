# AquaFlow Engineering Designer: AutoCAD exchange

## Export your design

1. Open **Engineering Design** and open the saved site project you want to edit.
2. Save your project and optionally export its JSON as a backup.
3. Scroll down the left panel and click **EXPORT AUTOCAD DWG**, then choose where to save the file.
4. Open the saved `.dwg` in AutoCAD 2022. This is a genuine AutoCAD 2018-format DWG, the native format used by AutoCAD 2022. The drawing uses meters and 2D model space. **EXPORT DXF** is also available.
5. Edit the boundary and move the fixture markers. Keep the exported fixture entities and their AquaFlow XDATA when you want their existing control settings to stay associated on import. Fixture names are editable TEXT annotations.
6. Save the edited drawing as DWG or ASCII DXF, then import it into AquaFlow.

Native DWG export/import uses licensed AutoCAD 2018 or later, or [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter), installed on the controlling PC. AquaFlow detects the CAD engine automatically. On this PC, it uses AutoCAD 2022. It performs local conversion with no fountain-controller commands. If neither engine is installed, it reports that DWG conversion is unavailable; it never renames a DXF into a DWG. DXF exchange works without a CAD engine. Advanced installations can set `AQUAFLOW_ACCORECONSOLE` or `AQUAFLOW_ODA_CONVERTER` to the full converter executable path.

The export includes the basin outline, nozzle/light/equipment markers, names, manual pipework, drawn depth zones and measurement lines. Fixture circles are position markers, not dimensioned equipment drawings. CAD export does not include PLC/I-CAN control commands, wiring schematics, show programming or a 3D AutoCAD model.

## Import a drawing

1. In Engineering Design, click **IMPORT AUTOCAD DWG / DXF** in the left panel.
2. Choose your `.dwg` or `.dxf` file, up to 10 MB. A DWG is converted locally by the installed CAD engine; an ASCII DXF is read directly. Use 2D model space for imported engineering geometry. Binary DXF is not supported.
3. Check **Drawing units**. Meters, millimeters, centimeters, inches and feet are supported and converted to meters. For unitless drawings, choose the actual units explicitly. A 36,000 mm basin should preview as 36 meters.
4. Choose the import method:
   - **Update current design** keeps existing control settings only when exported fixture IDs match. Omitted current fixtures remain in the design. Imported fixtures without a matching ID are added with no hardware address.
   - **Create a new design** creates an unsaved project with unassigned fixtures and no existing project ID. It does not overwrite the current saved project.
5. Map each CAD layer to its purpose. Unknown layers start as **Ignore**. Select the desired fixture type for newly drawn nozzle/light/equipment layers.
6. Choose the pool boundary if the drawing has several closed outlines. Open boundaries cannot be applied.
7. Review the preview, fixture counts, matched IDs, pool span and warnings. Keep **Invert CAD Y** checked for AquaFlow exports; change it for other drawings if needed. Specify the pool depth if the drawing does not provide it.
8. Click **Apply CAD design**. The engineering view fits the imported basin. Check the result before clicking **SAVE PROJECT**. **Undo** restores the previous design and project identity if you need to revert.
9. Recalculate hydraulics after a layout change. CAD import replaces manual pipes, drawn depth zones and measurements with those present in the selected drawing. It does not send hardware commands. Review and commission any new fixtures before using them in a live show.

## Drawing conventions

| CAD layer | Import purpose | Geometry |
| --- | --- | --- |
| `POOL_OUTLINE` | Pool boundary | Closed polyline, circle, ellipse or closed connected line/arc loop |
| `NOZZLES` | Nozzle positions | Circle centers, POINT entities or block insertion points |
| `LIGHTS` | Light positions | Circle centers, POINT entities or block insertion points |
| `EQUIPMENT` | Equipment positions | Circle centers, POINT entities or block insertion points |
| `PIPEWORK` | Pipe routes | Lines and polylines |
| `DEPTH_ZONES` | Depth-zone outlines | Closed outlines; AquaFlow exports retain depth metadata |
| `MEASUREMENTS` | Measurement lines | LINE entities |
| `ANNOTATIONS` | Names and annotations | TEXT/MTEXT; exported names remain associated with fixture IDs |

You can map other layer names in the import dialog. On fixture layers, a block represents one fixture at its insertion point, rather than importing every circle inside it. Non-fixture blocks are expanded with their position, rotation and scale. Some curves become short straight segments; the preview reports this approximation. Paper-space, meshes, solids and tilted/reversed-extrusion entities are skipped. Convert unsupported splines to 2D polylines in AutoCAD and remove unrelated drawing details before importing.

For a round trip of an existing commissioned site, prefer moving the original exported markers. Exploding, replacing or copying entities can remove or duplicate their identity metadata. AquaFlow rejects duplicate fixture IDs instead of guessing their hardware associations.
