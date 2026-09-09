# Memo Terminal Design System

## 1. Atmosphere & Identity

Memo is a quiet, keyboard-first workbench: dense enough to feel capable, calm enough to stay out of the conversation. Its signature is a cool cyan insertion point moving through an otherwise neutral graphite terminal, borrowing the spatial grammar of modern coding agents without copying their branding, copy, or exact components.

## 2. Color

| Role | Token | Dark value | Usage |
|---|---|---|---|
| Canvas | `$background` | `#0c0c0c` | App background |
| Surface | `$surface` | `#121212` | Composer and assistant rows |
| Raised | `$panel` | `#191919` | Dialogs and focused surfaces |
| Subtle | `$boost` | `#202020` | Status and tool activity |
| Text | `$text` | `#e7e5e4` | Primary copy |
| Muted | `$text-muted` | `#78716c` | Metadata and hints |
| Accent | `$primary` | theme-resolved cool cyan | Focus, submit, active state |
| Secondary | `$secondary` | `#a8a29e` | Assistant identity |
| Warning | `$warning` | theme-resolved amber | Permission and tool attention |

Light mode uses Textual's corresponding theme roles while preserving the same hierarchy. Accent is reserved for focus, active controls, and user authorship.

### Tonal recipes

- User row: `$boost` at 45% with a solid `$primary` rail.
- Assistant row: canvas fill with `$secondary` rail at 35%.
- Tool row: `$surface` fill with `$warning` rail at 55%.
- Primary action: `$primary` fill at 18%.
- Disabled control: whole-control opacity at 55%.
- Modal scrim: black at 72%; this is the sole non-theme overlay because it must dim every underlying theme role uniformly.

## 3. Typography

The host terminal monospace is the only typeface. Body text is one terminal cell high, labels use bold sparingly, and no decorative display scale is introduced.

## 4. Spacing & Layout

The base unit is one terminal cell. Transcript rows use one cell of vertical rhythm and two cells of horizontal inset. The message stream owns scrolling; the composer is pinned to the bottom. At narrow widths controls retain nine-column targets and the input absorbs remaining space.

## 5. Components

### Transcript row
- **Structure:** author label followed by plain-text content.
- **Variants:** user, assistant, tool.
- **States:** streaming content updates in place; tool rows shift copy by status.
- **Accessibility:** no color-only identity; every row includes a text label.
- **Layout:** full-width stack item inside the scrolling transcript.

### Command composer
- **Structure:** one-line status, input, voice control, send control.
- **States:** default, focus, hover, active, disabled, listening, thinking.
- **Accessibility:** keyboard-first submission, persistent text labels, visible focus.
- **Layout:** pinned cluster; input flexes and controls remain fixed width.

### Permission dialog
- **Structure:** title, explanation, command, optional path, deny/allow actions.
- **States:** denial focused by default; allow is visually cautionary.
- **Accessibility:** Escape denies; focus begins on the safe choice.

## 6. Motion & Interaction

Scrolling and streaming update immediately. No decorative animation is used; state changes are expressed through copy, focus, and tonal shifts. This respects reduced-motion users by construction.

## 7. Depth & Surface

Depth uses the documented tonal recipes plus single-cell keylines. Rounded chat-card borders and shadows are prohibited; the transcript reads as one continuous working surface.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

Maintain WCAG AA contrast where terminal palettes permit, preserve visible keyboard focus, never rely on color alone, and keep all primary controls reachable without a mouse.

### Accepted Debt

None.
