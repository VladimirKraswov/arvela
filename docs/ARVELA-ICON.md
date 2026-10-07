# Arvela app icon

Created with the built-in imagegen tool for the owner's request for a beautiful
application icon. Source: `src/assets/arvela-icon.png` (1254×1254 RGBA).
The original generated file is copied into the repository, with no raster edits.
Tauri's official icon command converts it to desktop bundle resources. The same
source is used by the sidebar and browser favicon. Native 32×32 output was
visually inspected; PNG has alpha, Windows ICO has multiple resolutions and
macOS ICNS is referenced by the bundle's Info.plist. Actual Windows/Linux display
was not checked here. The previous SVG remains as a historical design source.

## Generation prompt

> Use case: logo-brand. Create a beautiful finished desktop application icon for Arvela, a polished workspace for multiple AI coding agents. Single centered icon, square 1024x1024 composition. Deep ink navy squircle tile with softly rounded macOS app-icon corners, outside tile transparent. An original bold sculptural folded ribbon forms a graceful abstract capital A, with two interwoven arms suggesting collaboration and a clear triangular negative space. Premium satin glass/ceramic finish, restrained luminous gradients from soft turquoise through periwinkle to violet, subtle warm-white edge highlights. Elegant, calm, confident, precise silhouette. The ribbon mark fills about 65 percent of the tile, strong readability at 32px; broad simple shapes and tasteful shallow dimensionality. Straight-on orthographic view. No text, no labels, no tiny decorative details, no circuit boards, no robot, no sparkle/star motif, no mockup scene, no extra icons, no watermark. This is the actual production app icon, not a presentation.

## Regeneration

`npm run tauri -- icon src/assets/arvela-icon.png --output <temporary-directory>`

Copy the desktop files to `src-tauri/icons`; mobile directories emitted by the
CLI are outside this desktop project's scope. The image generator returned
1254×1254 rather than the requested1024×1024; Tauri accepts the square PNG and
produces the exact bundle dimensions.
