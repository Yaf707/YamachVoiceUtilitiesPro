# Yamach Voice Utilities Pro

> Made by Yamach — A unified voice moderation, monitoring, and analytics suite.

A powerful all-in-one Voice plugin for Equicord/Vencord that combines bulk voice operations, user tracking, activity logs, room reports, themes, and evidence tools. Built as a companion to `UserVoiceShow`.

## Highlights

### Voice Tools Panel
- Smart member selection with cross-server memory
- Bulk pull / move / distribute / mute / deafen / disconnect
- Round-robin, balanced, or random distribution modes
- Per-channel and per-row quick-action buttons
- Top toolbar shortcut with live selected-count badge
- Custom presets — save any member group for later
- One-click **Undo** for move/pull/distribute actions

### Yamach Command Center
Inside the same panel, switch to the Command Center for:
- **Live** — see anyone currently in voice with their companions
- **Watch Board** — track specific users across all servers
- **Logs** — granular event timeline (join/leave/mute/deaf/stream/video)
- **Reports** — room journey maps, "was with" search, evidence copy
- **Heatmap** — voice activity by day-of-week × hour-of-day
- **Stats** — per-user dashboard (total time, sessions, streams, companions)
- **Presets** — manage saved member groups
- **Alerts** — local notifications for tracked users
- **Data** — backup / restore JSON, cleanup tools
- **Themes** — 21 themes plus a custom builder

### Performance & Safety
- Adaptive 429 backoff with retry-after honoring
- Worker-pool concurrent execution (fast batched)
- Configurable batch size, delay between actions, and retries
- Auto-prune logs by max-entries and by age (days)
- Lighter DOM observer (~3× lower idle CPU)
- Privacy mode masks names in screenshots

### Customisation
- 21 themes: Yamach Dark, Discord Native, Midnight Glass, Neon Pro, Emerald Admin, Crimson Ops, Royal Purple, Minimal, Ocean Depth, Sunset Ops, Cyber Lime, Sakura Night, Amber Control, Ice Blue, Matrix Green, Obsidian Red, Steel Slate, Lavender Pulse, Yamach Gold, Ruby Dark, Custom Builder
- Bilingual UI (English / العربية) with full RTL support
- Configurable quick-button icons, shapes, sizes, accents, visibility

## Keyboard Shortcuts

| Action | Default |
| --- | --- |
| Open Voice Tools panel | `Ctrl+Shift+V` |
| Pull selected to me | `Ctrl+Shift+P` |
| Undo last action | `Ctrl+Shift+Z` |
| Clear selection | `Ctrl+Shift+X` |

Customise any of these in the plugin settings → section `07 Shortcuts`.

## Settings Sections

Settings are grouped with section headers:

| Section | What it controls |
| --- | --- |
| `01 General` | Language, visual style, panel density |
| `02 Panel` | Default scope, defaults for include-self / bots, post-action behaviour |
| `03 Voice row` | Per-row quick buttons (icons, position, size, accent) |
| `04 Top bar` | Top toolbar Voice Tools button |
| `05 Actions` | Execution mode, batch size, retries, undo, confirm threshold |
| `06 Yamach` | Log limits, auto-expire, alerts cooldown, auto-pull, privacy mode |
| `07 Shortcuts` | Keyboard bindings |

## Install

Copy the folder into:

```
src/userplugins/YamachVoiceUtilitiesPro/
```

Keep **UserVoiceShow** enabled alongside it.

## Changelog

- **V14** — Heatmap tab, Stats Dashboard tab, Presets system, Undo stack, Import backup, smart auto-pull, log auto-prune, categorised settings, optimised DOM observer
- **V13** — Log flow polish: newest events first, per-event delete, quick member activity card
- **V11** — Self vs server mute/deaf split icons (blue / red with shield)
- **V10** — Discord IconUtils for guild avatars with safe fallback
- **V8** — Multi-room popout, themed-everywhere UI, expanded theme catalogue

## Credits

Built on top of the original `voiceChatUtils` core; extended with tracking, logs, reports, evidence tools, themes, presets, undo, heatmap, stats dashboard, and rate-limit-aware execution by Yamach.
