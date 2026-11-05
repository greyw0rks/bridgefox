# BridgeFox studio design

The default Warm daylight palette uses cream surfaces, coral actions, lavender review states, mint success states, and a dark navigation rail. The visual direction was selected by the user. Space Grotesk headings, Manrope body text, and IBM Plex Mono metadata are served locally from font packages.

## Layout

The dashboard leads with a browser handoff illustration and the import/example choices. Statistics and history use actual local report metadata. Compatibility, review, and export share a three-stage navigation bar. The source editor has a searchable file tree and split or unified review; the focus control hides surrounding panels. At ordinary desktop widths, activity appears below the editor to preserve code width. At widths of 1600px and above it becomes a third column. Tablet and mobile layouts stack the source panes and preserve internal code scrolling.

Export pairs the package and download action with actual validation results, followed by concrete temporary-install steps. The native settings and history dialogs retain keyboard focus and Escape dismissal.

## Palettes and motion

| Palette | Canvas | Action | Detail | Navigation |
| --- | --- | --- | --- | --- |
| Warm daylight | `#f6f4ed` | `#ed6548` | `#d8cff2` | `#26312c` |
| After hours | `#1b2227` | `#f2a58c` | muted violet | `#151c20` |
| Garden studio | `#f2f4ec` | `#267c60` | `#c6ded0` | `#253c31` |

Choose a palette in settings or cycle it with the header appearance control. The `bridgefox-palette` and `bridgefox-motion` preferences persist in localStorage. CSS variables on the root update the whole interface, including syntax highlighting for the dark palette.

Framer Motion drives the floating browser cards, travelling package, pointer parallax, button response, navigation indicators, page and tab transitions, scroll reveals, and activity entrances. The diagram is decorative and does not represent a completed migration. A header pause control and settings switch disable motion. Device reduced-motion preferences take priority, including explicit smooth-scroll calls. Appearance-dependent motion starts after hydration so the initial markup stays consistent on devices with reduced motion enabled.

## Verification

Run `npm run check:ui` against a running app. It exercises all three palettes, persistence and quick cycling, paused and enabled decorative motion, device reduced motion, desktop/mobile overflow, code search and view controls, import, local migration, reports, native dialogs, and ZIP export. Screenshots and downloads are written to ignored `artifacts/ui/`; the latest checked-in result is in `docs/evidence/ui-checks.json`. No live Otari calls are needed for these checks.

The separate pipeline suite covers compatibility and patch guardrails. Exported source still requires a Firefox runtime test; this UI revamp does not turn static compatibility scores into runtime guarantees.
