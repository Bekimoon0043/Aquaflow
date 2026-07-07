# LuxuryCon Platform Brand System

How every LuxuryCon software product is branded so users can tell them apart at a glance
(especially in the Windows taskbar) while still reading as one family.

---

## The rule: shield + element + accent

The **LuxuryCon shield** (forest-green shield, gold "L", gold filigree) is the **company
logo** and the **constant** across all products. Each platform differentiates itself with
**one added element** and **one signature accent colour**:

| Platform | Added element | Accent colour | App-icon idea |
|----------|---------------|---------------|---------------|
| **AquaFlow Studio** | water (droplet / wave) | water-blue `#1E88E5` | shield + blue droplet at the base |
| **LuxuryForm Studio** | chisel / sculpture | bronze | shield + chisel mark |
| **LuxuryScape Studio** | leaf / plant | earth green | shield + leaf accent |
| **LxFX Trading** | chart / arrow | gold `#C9A227` | shield + up-arrow/chart |

The shield never changes. Only the element + accent do. This keeps the family coherent while
making each taskbar icon distinct.

### Shared base palette

| Token | Hex | Use |
|-------|-----|-----|
| Forest green | `#0D2A1A` | shield base, primary brand |
| Dark forest | `#0A1A0F` | splash / installer backgrounds |
| Gold | `#C9A227` | "L", wordmarks, highlights |
| Muted gold | `~#967828` | secondary text |
| (per-platform accent) | — | the differentiator (AquaFlow = `#1E88E5`) |

---

## AquaFlow Studio specifics

- **App icon** (`assets/AquaFlow.ico`, `assets/icon.png`): LuxuryCon shield with a
  **water-blue droplet** straddling the shield's lower point ("water from the shield"). Kept
  simple so it is readable at 16–32 px (taskbar). `.ico` embeds 256/128/64/48/32/16.
- **Document icon** (`assets/aquashow.ico`): the same mark with a small gold document fold,
  for `.aquashow` files.
- **Splash** (`assets/splash.png` + `splash.html`): dark-forest background, shield centred,
  "AquaFlow Studio" in gold, "by LuxuryCon" muted, loading bar (blue fill), "Exceed Yourself".
- **Installer sidebar** (`build/installerSidebar.bmp`, 164×314) and **header**
  (`build/installerHeader.bmp`, 150×57): shield + wordmark on the brand background.
- **Window title:** `AquaFlow Studio — LuxuryCon`.
- **About dialog:** shield, "AquaFlow Studio", version, "by LuxuryCon — Exceed Yourself",
  build/version info, © 2026 LuxuryCon.

---

## Regenerating the assets

All AquaFlow packaging graphics are generated from the source shield by one script:

```
py -3.12 aquaflow/desktop/scripts/generate_brand_assets.py
```

It reads the shield from `E:\samber coorporation\luxury con\LOGO\New revised LOGO\`
(`LuxCon Icon.png`, falling back to `Pure Logo.psd` / the full logo), adds the water element,
and writes the icon/splash/installer graphics into `aquaflow/desktop/assets/` (and syncs
`build/icon.png`). Requires Pillow (`pip install Pillow`). Re-run whenever the logo changes.

> **Source-of-truth note:** the shield artwork lives in the LuxuryCon LOGO folder, not in this
> repo. The generated assets are committed so a build machine needs only the repo. If the CEO
> supplies higher-resolution or final artwork, drop it in and re-run the script.

---

## When adding a new LuxuryCon platform

1. Start from the shield.
2. Choose the element + accent from the table above (or extend it).
3. Copy `generate_brand_assets.py`, swap the accent colour + element drawing, regenerate.
4. Keep the window-title pattern `<Product> — LuxuryCon` and the "Exceed Yourself" tagline.
