# Depence camera animation for AquaFlow

How Depence R4 and similar tools let show designers animate the 3D camera, and what AquaFlow should copy. Researched November 2026. Depence's public manual is thin on some details (easing list, navigation bindings, FOV keys). Where it is silent this report says so, and does not guess.

## 1. How Depence R4 does it

**Cameras are scene objects.** Main Menu > Create > Scene > Camera adds a Camera object. A new camera starts at the current editor view, and you move and rotate it with the mouse like any other object ([Depence R4: Camera Animation](https://help.depence.com/depence-show-and-animation/depence-show-sequencer/depence-camera-animation)). The viewport uses the free *Editor-Camera* by default. Viewport-Menu > Camera > Active Camera shows the view through an animated camera, which keeps working navigation separate from the shot.

**Keyframes live on the same timeline as the show.** Dragging a camera into the Sequencer track view creates an Object-Keyframe track, with Position, Rotation and Scale property tracks and a first key at the camera's current pose ([Camera Animation](https://help.depence.com/depence-show-and-animation/depence-show-sequencer/depence-camera-animation); [Keyframe Animations](https://help3.depence.com/depence-show-and-animation/depence-show-sequencer/depence-keyframe-animations)). The recording workflow:
1. Move the playhead.
2. Move the camera.
3. Press the track's record button, which keys all property tracks at once.
4. To overwrite a key, park the playhead on it (it turns red) and record again.
5. Scrub the playhead to preview.

More properties can be keyed via "Add Keyframe properties" ([Keyframe Animations](https://help3.depence.com/depence-show-and-animation/depence-show-sequencer/depence-keyframe-animations)). Syncronorm also has a dedicated "Camera Keyframe Animation" how-to video ([Video tutorials](https://www.syncronorm.com/support/video-tutorials)).

**Path and timing are set separately.** The Position track's *SplineMode* is Cubic by default ("soft edges"), or Linear. Separate *easing* options "define how to interpolate the timings" ([Spline Mode](https://help.depence.com/depence-show-and-animation/depence-show-sequencer/depence-keyframe-animations/depence-spline-mode)). R4 improved the cubic interpolation so camera moves are "smoother and more natural" ([Depence R4](https://www.syncronorm.com/depence-r4)).

**Horizon lock.** Interpolating rotations can tilt the camera. Ticking *LockZRotation* on the Rotation track "will always keep the Camera aligned to the horizon" ([Camera Animation](https://help.depence.com/depence-show-and-animation/depence-show-sequencer/depence-camera-animation)).

**Target Camera (new in R4).** This camera "automatically aligns and focuses on a selected object", which makes keyframing easier because you only animate position ([Depence R4](https://www.syncronorm.com/depence-r4)).

**Cuts vs moves.** A *Camera Selector* object goes on the timeline, and keying its *Active Camera* setting gives hard cuts between cameras. Interpolated keys on one camera give moves ([Camera Animation](https://help.depence.com/depence-show-and-animation/depence-show-sequencer/depence-camera-animation)). R4 cameras can also feed live video to screens in the scene ([Depence R4](https://www.syncronorm.com/depence-r4)).

**Path display.** The viewport draws the animation as a spline, and its key points can be dragged. Depence warns that moving key points "is view-dependent", so it recommends editing them in Quad-View ([Keyframe Animations](https://help3.depence.com/depence-show-and-animation/depence-show-sequencer/depence-keyframe-animations)).

**Navigation helpers** ([Shortcuts](https://help.depence.com/depence-program-overview/depence-shortcuts)):
- **Saved views:** Ctrl+F1…F12 stores a camera view and F1…F12 recalls it.
- **Framing:** **O** zooms to the selection, and **F+Click** focuses on the point under the mouse.
- **Timeline:** Space or Enter plays.

Depence R3's *Freeze Animations* pauses moving objects so you can frame a shot calmly ([Depence R3](https://www.syncronorm.com/depence-r3)). I could not find Depence's mouse bindings for orbit, pan and zoom documented publicly.

**Rendering video.** Video renders through the active camera at up to 4K with supersampling ([Depence fountain brochure](https://www.syncronorm.com/fileadmin/Public_Downloads/Brochures/DepenceBrochureFountain24_web.pdf)). R4 adds motion blur based on frame rate and shutter angle ([Depence R4](https://www.syncronorm.com/depence-r4)). R3 adds long-exposure renders of a loop region, which suits fountains ([Depence R3](https://www.syncronorm.com/depence-r3)).

## 2. Comparable tools

- **Unreal Sequencer:** the *Camera Rig Rail* follows a spline, and you key one value, "position on rail" from 0 to 1. The *Rig Crane* keys pitch, yaw and arm length. Rails and cranes can be combined into a dolly-plus-jib ([UE camera jibs and dollies](https://dev.epicgames.com/documentation/en-us/unreal-engine/camera-jibs-and-dollies-in-unreal-engine); [UEFN rail and crane](https://dev.epicgames.com/documentation/en-us/fortnite/camera-rig-rails-and-rig-crane-in-unreal-editor-for-fortnite)). This gives guaranteed-smooth motion from a single number.
- **Blender:** *Follow Path* drives position along a curve, and *Track To* aims the camera at a target ([Blender Follow Path](https://docs.blender.org/manual/sr/4.4/animation/constraints/relationship/follow_path.html)). Users find the setup confusing because constraint order matters and "Follow Curve" is off by default ([BlenderArtists](https://blenderartists.org/t/making-a-camera-follow-a-path-why-so-difficult/1272829)).
- **Cinema 4D Camera Morph:** blends between several fixed cameras using one keyed *Blend* value, with Linear or eased interpolation ([Maxon: Camera Morph](https://help.maxon.net/c4d/2027/en-us/Content/html/TMORPHCAM.html)). It warns that very different shots pass through awkward in-between views ([Novedge tip](https://novedge.com/blogs/design-news/cinema-4d-tip-mastering-seamless-camera-transitions-with-cinema-4ds-camera-morph-tag)).
- **grandMA3 3D:** a pool of stored cameras, plus zoom-to-fit, fit-selected, reset and a pivot mode ([grandMA3 3D cameras](https://help2.malighting.com/Page/grandMA3/patch_3d_camera/en/1.9)). I found no public documentation of keyframed camera paths there.
- **three.js (AquaFlow's renderer):** OrbitControls has `zoomToCursor` and `minDistance`/`maxDistance` dolly limits. "Zoom" is actually a dolly toward the target, so zoom stalls when the camera gets close to its pivot ([three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)).

## 3. Common pain points

- The camera tilts or rolls between keys (Depence's fix is LockZRotation).
- Editing a path is view-dependent.
- Stepping through keys is slow because there is no auto-key.
- Interpolating between very different shots goes through awkward intermediate views.
- Constraint and path setups are hard to learn (Blender).
- Zoom slows to a crawl or stops near the pivot, and it doesn't zoom toward what is under the cursor.

## 4. What AquaFlow should copy

1. **Camera track on the show timeline:** a "Camera" lane in the show programmer, saved in the project. Each key holds position, target, FOV and roll, aligned to the music.
2. **"Add key here" button:** Depence's record step in one click. It stores the current view at the playhead, and clicking on an existing key overwrites it.
3. **Two settings per key:** a path shape (Smooth/cubic Catmull-Rom or Linear), and timing easing to the next key (Linear, Ease in, Ease out, Ease in-out, Hold). Hold gives a hard cut.
4. **Target-based camera:** keys store a look-at point rather than a rotation, so moves can't tumble. A "Keep horizon level" option on by default replaces LockZRotation.
5. **Preset moves** generated as editable keys at the playhead, sized to the basin and to the length of the selected range:
   - Orbit
   - Dolly in/out
   - Crane up
   - Fly-by
   - Push-in to selection
   - Rail along a drawn guide line
6. **Path display in 3D:** the camera path drawn as a line with numbered key markers and a camera frustum at the playhead, togglable.
7. **Edit and preview views:** a "Through animated camera" preview toggle, separate from the free editor camera (Depence's Active Camera vs Editor-Camera). Optionally, a small picture-in-picture monitor.
8. **Reliable navigation:**
   - Zoom toward the cursor with a cursor-picked pivot.
   - Zoom speed proportional to distance, so it never stalls near the pivot.
   - Distance limits taken from the site size.
   - **F** frames the selection or the whole site, and **O** zooms to the selection.
   - Ctrl+1…9 saves a view and 1…9 recalls it.
   - Smooth damped motion.
9. **Video export uses the camera track:** the baked renderer follows the track frame-exactly, deterministically, at any fps. Later, motion blur based on shutter angle.
10. **Camera cuts and shots list:** named shots, such as STAND HERE and the saved camera views, can be dropped onto the timeline as cut or blend keys. A "Freeze water" toggle pauses the simulation while you frame a shot.
