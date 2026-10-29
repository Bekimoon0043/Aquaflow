# AutoCAD drafting methods for the basin designer

How AutoCAD lets users draw exact shapes from the keyboard, what makes it hard for beginners, and what the AquaFlow Site & Basin Designer should copy and simplify. (Research date: 2026-10-29.)

## 1. How AutoCAD does it

### Ways to enter a point (works at every "Specify point" prompt)
| Typed | Meaning |
|---|---|
| `5` + Enter | **Direct distance entry**: 5 units in the direction the cursor points ([Autodesk](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-BF4A06D8-2D66-427D-9460-B62A479B22B4.htm)) |
| `5` Tab `30` Enter | Dynamic Input: length field, Tab locks it (lock icon), then angle field. Enter after the first value ignores the second field ([Autodesk coordinate entry](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Core/files/GUID-0A0135DB-3216-482B-81DD-74E6DB8CA3E3.htm)) |
| `5<30` | Polar: length 5 at 30° |
| `@3,4` | Relative: 3 across, 4 up from the last point |
| `3,4` | With Dynamic Input on, the second point is relative by default; `#3,4` forces absolute ([study guide](https://open-exam-prep.com/study-guides/autodesk-acu-autocad/draw-with-accuracy/dynamic-input-dde)) |

Helpers: **F10 Polar tracking** (snaps the cursor to 15/30/45° rays, turns Ortho off), **F8 Ortho**, **F3 Object snaps**, **F11 Object snap tracking** (hover a point to "acquire" it, then follow dotted alignment paths) ([Autodesk OSNAP commands](https://help.autodesk.com/cloudhelp/2017/ENU/AutoCAD-LT/files/GUID-C2DACA0F-F91E-4A85-9C38-B3AAE74F73A3.htm)), **F12 Dynamic Input** ([Arkance](https://ukcommunity.arkance.world/hc/en-us/articles/21550451370770-AutoCAD-Dynamic-Input)). Enter or Space ends a command; Enter/Space at an empty prompt repeats the last command; Esc cancels. Aliases (L, PL, REC, C, A, EL, POL) are defined in acad.pgp ([Autodesk blog](https://www.autodesk.com/blogs/autocad/autocad-command-aliases/)).

### Commands
- **LINE (L)**: first point → next point… repeat. Options: **U**ndo (removes last segment), **C**lose (back to first point, ends).
- **PLINE (PL)**: one connected object. Options: **A**rc (tangent arc segments), **C**lose, **H**alfwidth, **L**ength (segment of given length continuing the previous direction/tangent), **U**ndo, **W**idth ([Autodesk PLINE](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT/files/GUID-11883C70-6435-4F80-8FB4-F6E933B8FD94.htm)).
- **RECTANG (REC)**: first corner → other corner, or **D**imensions (type length, width, then click which quadrant); **R**otation; **C**hamfer/**F**illet corners, which stick for later rectangles ([Autodesk RECTANG](https://help.autodesk.com/cloudhelp/2020/ENG/AutoCAD-Core/files/GUID-188B2DDA-6CD8-4D37-BF26-E6CF27C34C75.htm), [study guide](https://open-exam-prep.com/study-guides/autodesk-acu-autocad/basic-drawing-objects/geometric-shapes)).
- **CIRCLE (C)**: centre → radius (or **D**iameter); **3P**, **2P** (diameter ends), **Ttr** (tangent, tangent, radius) ([Autodesk CIRCLE](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-C60B6D5D-AAEB-420F-917F-6E6B47E92F48.htm)).
- **ARC (A)**: default 3 points; variants Start-Centre-End/Angle/Length, Start-End-Angle/Radius. CCW by default, Ctrl flips; "Length" means chord ([Autodesk ARC](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT/files/GUID-30ECFD30-A1D6-4D60-9DD1-B487603F6772.htm), [Autodesk blog](https://blogs.autodesk.com/autocad/mastering-autocad-arc-command)).
- **ELLIPSE (EL)**: axis endpoint → other axis endpoint → half of other axis; or **C**entre → axis end → other half-axis; **A**rc for partial ellipse.
- **POLYGON (POL)**: number of sides → centre → **I**nscribed/**C**ircumscribed → radius; or **E**dge (two points define one side) ([guide](https://autocad-vagon.pages.dev/blog/rectang-and-polygon-fast-shape-drafting/)).

### What the simpler tools do
- **SketchUp**: start the line, point the cursor, just type `5` Enter; no need to click the Measurements box (clicking it actually breaks input). Retype immediately to correct the last line ([SketchUp forum](https://forums.sketchup.com/t/can-not-enter-measurements-with-online-version/56545), [SketchUp help](https://help.sketchup.com/en/managing-units-measurement)).
- **Fusion 360**: editable length/angle boxes appear next to the cursor by default; Tab between them, Enter confirms and the value is locked as a dimension ([Autodesk Fusion blog](https://www.autodesk.com/products/fusion-360/blog/dimensions-in-sketches-fusion/)).
- **Shapr3D**: no separate dimension tool; selecting any element shows its dimension, tap to edit; on-screen numpad with a lock button ([Shapr3D support](https://support.shapr3d.com/hc/en-us/articles/18816009328284-Sketching-in-Shapr3D), [forum](https://discourse.shapr3d.com/t/obvious-question-about-locking-the-length-ofa-line/13878)).

## 2. Ten things that make AutoCAD hard for beginners
1. The prompt lives in a command line at the bottom that new users don't read ([Noble Desktop](https://nobledesktop.com/learn/autocad/is-autocad-a-hard-class)).
2. Clicking icons "does nothing" until you answer the next prompt.
3. Options are single hidden letters in brackets ([A/C/H/L/U/W]).
4. Three coordinate syntaxes (`@`, `<`, `#`) and a relative/absolute default that changes with Dynamic Input.
5. Many modes (F3/F8/F10/F11/F12) whose state is easy to lose; temporary overrides silently disable direct distance entry ([Autodesk](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-LT/files/GUID-BF4A06D8-2D66-427D-9460-B62A479B22B4.htm)).
6. Angles are measured CCW from east, not the way people think ("up", "left").
7. Sticky settings (fillet radius on RECTANG) surprise later drawings.
8. LINE makes separate segments, not a closed shape, unless you know PLINE + Close.
9. Too many variants per command (11 ARC methods).
10. No live feedback of the result's area/size until the command ends.

## 3. Recommendations for the AquaFlow designer
1. **Just type a number.** While any draw tool waits for a point, digits open a length box beside the cursor (no click, no mode). Enter = place the point in the cursor direction. Show the box *before* typing as a live read-out (length + angle).
2. **Tab = angle, comma = second value** (`12,8` for rectangle width,length; `5<30`, `@3,4` still work for experts). Show the accepted formats as a hint line.
3. **Live dimensions** on the rubber-band segment and on every finished edge; double-click an edge label to retype its length.
4. **Close by clicking the start point** (magnet + highlight), plus `C`/Enter/double-click; show running area and perimeter while drawing.
5. **Undo last point** with Backspace / `U` / Ctrl+Z inside the command, without cancelling the shape.
6. **On-screen option buttons** beside the prompt (Close · Undo · Arc · Line · Exit) with the letter shortcut shown on each, so the AutoCAD letters are learnable, not hidden.
7. **One "Shape" family**: Line/Polyline, Rectangle (2 corners or W×L, optional rotation and corner radius per shape, not sticky), Circle (centre-radius / diameter / 2P / 3P), Arc (3-point and start-centre-end only), Ellipse, Polygon (sides, inscribed/circumscribed, edge), Freehand spline. Avoid the 11-way ARC menu.
8. **Polar tracking at 15° and snaps always on**, Shift to lock direction, F8 ortho; show the snap name (End, Mid, Centre, Grid) by the cursor; status chips that show each mode's state.
9. **Sticky last command**: Enter/Space on an empty prompt repeats the last shape tool; Esc once clears typed text, twice exits.
10. **Angles in plain terms**: 0° right, 90° up the screen; show a small compass at the cursor. Command aliases (L, PL, REC, C, A, EL, POL) available through a command line with autocomplete for AutoCAD users.
