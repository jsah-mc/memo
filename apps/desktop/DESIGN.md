# Memo Desktop Design System

## Current visual direction

The conversation experience follows the familiar visual language of modern system messaging apps without copying branded assets: native system typography, a cool blue action color, translucent neutral navigation, compact conversation rows, blue outgoing bubbles, gray incoming bubbles, and a rounded message composer. Agent creation and switching remain first-class Memo features.

The desktop ships in a dark appearance: graphite navigation, a near-black conversation canvas, light system text, gray incoming bubbles, and blue outgoing bubbles and actions.

Liquid glass is reserved for the active-agent identity in the titlebar. Refraction and chromatic aberration remain subtle enough to preserve text contrast, and the effect never owns layout-critical containers.

## 1. Atmosphere

Memo is a quiet, focused AI workbench built with shadcn and Base UI primitives: clear state layers, generous shapes, and legible hierarchy. Catppuccin gives the system its warm, low-contrast character without compromising desktop density.

## 2. Palette

- Light mode uses Catppuccin Latte: Base `#eff1f5`, Mantle `#e6e9ef`, Text `#4c4f69`, Blue `#1e66f5`, Red `#d20f39`.
- Dark mode uses Catppuccin Mocha: Base `#1e1e2e`, Mantle `#181825`, Text `#cdd6f4`, Blue `#89b4fa`, Red `#f38ba8`.
- Material primary/container pairs use Catppuccin Blue and Sapphire; secondary containers use Surface tones.
- `background`: Catppuccin Base; `sidebar`: Mantle; elevated surfaces step through Surface 0 and Surface 1.
- Borders are low-contrast outlines. Material tonal surfaces provide most of the separation.

## 3. Typography

- UI copy uses the native variable system sans stack for a crisp desktop feel.
- Status, metadata, and technical labels use the monospace stack.
- Headings use weight and spacing for hierarchy; avoid oversized display type.
- Conversation text stays at a comfortable 15–16px with relaxed leading.

## 4. Spacing and Layout

- The title bar is 40px and the status bar is 24px.
- The sidebar is a persistent navigation surface on wide screens and a drawer on narrow screens.
- The thread viewport owns vertical scrolling; the thread list owns sidebar scrolling. The application root never scrolls.
- Conversation content is centered at roughly 48rem and keeps 16–24px edge clearance.
- Use an 8px base rhythm, with 4px only for compact control interiors.
- The sidebar has two levels: a fixed agent switcher at the top and independently scrolling conversation history below. Labels use the regular interface typeface and sentence case.
- Window chrome uses a borderless custom titlebar that identifies the active agent and remains draggable around its interactive controls.
- The sidebar is visually layered above the titlebar, and agent controls begin at its top edge without a reserved titlebar gap.
- The agent sidebar is permanently visible and has no collapse toggle.
- The sidebar contains agent creation and selection only; conversation history is intentionally absent from the persistent navigation.
- The sidebar and workspace meet directly without a divider border.
- Empty sidebar space is a native window drag region; buttons, links, inputs, and text areas inside it remain non-draggable and interactive.
- Do not add a persistent status bar; transient state belongs near the action it affects.

## 5. Components

- Buttons use the shared shadcn/Base UI primitive with Catppuccin state colors, visible focus, and compact desktop sizing.
- Inputs use a visible 1px outline and a Catppuccin Blue focus ring.
- The composer is an M3 surface container with a 28px shape, subtle elevation, and clear action grouping.
- Thread rows use a pill-shaped secondary container for selection.
- User messages use a restrained raised surface; assistant messages remain open on the canvas.
- Status indicators pair icon, label, and color so state never relies on color alone.
- Agent rows pair a colored monogram, name, and role. The active agent uses the secondary container and a check indicator.
- The create-agent dialog collects name, role, and instructions in one short form; validation is inline and creation immediately selects the new agent.
- Built-in agents cannot be deleted. Custom agents expose a labeled delete action on hover and keyboard focus.

## 6. Motion

- Motion is functional and fast: 120–180ms for hover, focus, and entry transitions.
- Loading indicators may rotate; decorative looping animation is avoided.
- Respect `prefers-reduced-motion` globally.

## 7. Depth

- Depth follows M3 elevation: tonal layering first, then a soft low-opacity shadow.
- Title and status bars use translucent surfaces with backdrop blur where supported.
- Popovers may use a stronger shadow; normal controls should remain nearly flat.

## 8. Accessibility and Debt

- Keyboard focus is always visible in Catppuccin Blue and never encoded only by a background change.
- Interactive targets remain at least 32px in dense desktop navigation and 40px in the composer.
- Light and dark themes follow the operating system.
- The app currently relies on system fonts rather than bundling a brand typeface; this is intentional to keep startup local and deterministic.
- Agent selection uses `aria-pressed`; creation fields have persistent labels; destructive actions include the agent name in their accessible label.
