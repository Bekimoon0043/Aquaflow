# AquaFlow UI
Use Panel/PanelHeader for tools, Section for collapsible properties, Toolbar and IconButton for commands, and PropertyGrid/PropertyRow for editors. Icon buttons require a descriptive label and optional shortcut. Use NumberField for engineering values (drag the handle; Shift fine, Ctrl coarse). Pass units separately. Use KeyframeButton only when a real animation action is wired.

Use semantic CSS variables from globals.css; reserve accent for selection, focus and primary actions. Type sizes are 11/12/13px, spacing is a multiple of 4px, radii are 3px. Fonts and SVG icons are local; no external assets. Static presentation belongs in CSS. Inline styles are for runtime geometry or user colors. UI state must not change project schema. Hidden expensive views must suspend rendering.
