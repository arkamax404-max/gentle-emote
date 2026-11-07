<div align="center">
  <img src="assets/gentle-logo-only.png" alt="Gentle Emote" width="132" />

# Gentle Emote

**A Gentleman beside the prompt. He acts out the agent. He uses no tokens.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

A pixel-art **Gentleman** that sits in a frame to the left of your prompt and acts out what the agent is doing. Works in [Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell) and [Pi](https://pi.dev).

He listens to local session events: no model calls or context. Networking is off by default; optional external-display mirroring sends only avatar images and visual metadata. Forked from [cgxeiji/pi-emote](https://github.com/cgxeiji/pi-emote).

## Scenes

One frame per state, shown with the pink accent (yours follows `/gentle:customize`). Every frame of every animation is in the [gallery](docs/gallery.md), and `/emote demo` plays them live.

<table width="100%">
  <tr>
    <td align="center"><img src="docs/scenes/hi.png" alt="hi" width="96"><br><code>hi</code></td>
    <td align="center"><img src="docs/scenes/idle.png" alt="idle" width="96"><br><code>idle</code></td>
    <td align="center"><img src="docs/scenes/think.png" alt="think" width="96"><br><code>think</code></td>
    <td align="center"><img src="docs/scenes/talk.png" alt="talk" width="96"><br><code>talk</code></td>
    <td align="center"><img src="docs/scenes/read.png" alt="read" width="96"><br><code>read</code></td>
    <td align="center"><img src="docs/scenes/write.png" alt="write" width="96"><br><code>write</code></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/scenes/tool.png" alt="tool" width="96"><br><code>tool</code></td>
    <td align="center"><img src="docs/scenes/ask.png" alt="ask" width="96"><br><code>ask</code></td>
    <td align="center"><img src="docs/scenes/success.png" alt="success" width="96"><br><code>success</code></td>
    <td align="center"><img src="docs/scenes/failure.png" alt="failure" width="96"><br><code>failure</code></td>
    <td align="center"><img src="docs/scenes/compact.png" alt="compact" width="96"><br><code>compact</code></td>
    <td align="center"><img src="docs/scenes/delegate.png" alt="delegate" width="96"><br><code>delegate</code></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/scenes/explore.png" alt="explore" width="96"><br><code>explore</code></td>
    <td align="center"><img src="docs/scenes/build.png" alt="build" width="96"><br><code>build</code></td>
    <td align="center"><img src="docs/scenes/verify.png" alt="verify" width="96"><br><code>verify</code></td>
    <td align="center"><img src="docs/scenes/judge.png" alt="judge" width="96"><br><code>judge</code></td>
    <td align="center"><img src="docs/scenes/review.png" alt="review" width="96"><br><code>review</code></td>
    <td align="center"><img src="docs/scenes/jira.png" alt="jira" width="96"><br><code>jira</code></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/scenes/jobs.png" alt="jobs" width="96"><br><code>jobs</code></td>
    <td align="center"><img src="docs/scenes/yolo.png" alt="yolo" width="96"><br><code>yolo</code></td>
    <td align="center"><img src="docs/scenes/super-yolo.png" alt="super-yolo" width="96"><br><code>super-yolo</code></td>
    <td align="center"><img src="docs/scenes/remember.png" alt="remember" width="96"><br><code>remember</code></td>
    <td align="center"><img src="docs/scenes/grandma.png" alt="grandma" width="96"><br><code>grandma</code></td>
    <td align="center"><img src="docs/scenes/bye.png" alt="bye" width="96"><br><code>bye</code></td>
  </tr>
</table>

The subagent scene comes from the `agent` argument of the tool call, so a new agent that follows the same naming gets the right scene for free; a call without one (for example, continuing a task by id) shows `delegate`.

The subagent scenes, `jobs`, `yolo`, `super-yolo` and `remember` need the matching Gentle Shell tools or the Engram extension. Without them those states simply never trigger; the rest works the same in plain Pi.

Want a different character? [Create your own avatar](#create-your-own-avatar).

## Install

```bash
# Gentle Shell
gentle-shell install npm:gentle-emote

# Pi
pi install npm:gentle-emote
```

Restart the session (or `/reload`) and the Gentleman says hi.

## Commands

| Command | What it does |
|---------|--------------|
| `/emote` | Lists every state |
| `/emote <state>` | Previews one state for a few seconds (tab-completes), e.g. `/emote delegate` |
| `/emote demo` | Plays every state in sequence |
| `/emote idle` | Stops a preview and goes back to rest |

Any new prompt cancels a preview, so the avatar always follows the real agent.

## Config

Drop a `config.json` with only the keys you want to change in either place (the later one wins):

- `<agent dir>/extensions/gentle-emote/config.json`: global. The agent dir is `PI_CODING_AGENT_DIR`, or `~/.pi/agent` by default.
- `.pi/extensions/gentle-emote/config.json`: per project.

```json
{
  "frameRows": 5,
  "grandmaAfterMs": 120000
}
```

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `true` | Turns the avatar on or off |
| `placement` | `"beside-editor"` | Where the avatar sits: `"beside-editor"` or `"above-editor"` |
| `frame` | `true` | Draws a rounded frame around the avatar |
| `frameRows` | `4` | Avatar height in terminal rows. The prompt grows to match it |
| `minEditorWidth` | `40` | Below this prompt width the avatar hides to leave room for typing |
| `grandmaAfterMs` | `30000` | Idle time before the grandma appears (any key resets it). Use `0` to disable it |
| `farewellPattern` | Spanish and English goodbyes | Regex (case-insensitive) that triggers `bye` |
| `accent` | `"auto"` | Rose and headband color: `"auto"` follows `/gentle:customize`; or `"pink"`, `"cyan"`, `"yellow"`, `"green"`, or a hex like `"#ff6ec7"` |
| `readingSpeed` | `4` | Words per second used to pace the `/emote talk` preview |
| `holdDuration` | see `config.json` | How long `hi`, `success`, `failure` and `bye` stay on screen (ms) |
| `emotes` | `gentleman` | Emote set per model or thinking level (see below) |
| `terminals` | see `config.json` | Renderer per terminal (see below) |

`config.json` in the package root has every default.

## Mirror to an external 64×64 display

With the sibling `emote-display-simulator` receiver running locally, add this to `.pi/extensions/gentle-emote/config.json` (or your global config):

```json
{
  "externalDisplay": {
    "enabled": true,
    "url": "http://127.0.0.1:8000/emote",
    "timeoutMs": 1000
  }
}
```

Run `/reload`, open the simulator in your browser, then `/emote demo`. Set `enabled` to `false` and reload to stop. Shutdown/reload aborts delivery and discards pending frames.

- **Trust:** project config can enable outbound requests and override the destination through the normal layered merge. Review it before using this extension in a project. Use only local, trusted destinations: this iteration has no authentication; HTTP is unencrypted. Do not expose the receiver publicly. URLs must explicitly use HTTP(S), without credentials or fragments. No prompts, tool arguments, session IDs, file paths, or credentials are sent.
- **Options:** disabled by default; URL defaults to empty (no implicit destination). `timeoutMs` defaults to `1000` and must be finite between `1` and `30000` inclusive. Invalid options safely disable networking without disabling the local avatar.
- **Image:** raw binary PNG, exactly 64×64, opaque black background. Post-accent sprites are centered without enlargement; oversized sprites shrink proportionally with nearest-neighbor sampling. Terminal borders are not mirrored. A separate cache retains at most 32 prepared sprites.
- **Delivery:** one request in flight and one replaceable latest pending frame; intermediate frames may be dropped. No retries or redirects. Identical image + state/frame/set selections are deduplicated even on forced terminal redraws. Failure never blocks animation; a failed selection is not retried until a visual change.
- **Scope:** image renderers only (including Kitty Unicode placeholders). ASCII and headless sessions do not mirror. Hidden terminal widgets may still select frames; this is not a separate headless animation engine.

### Receiver protocol v1

`POST` to the configured URL with `Content-Type: image/png` and these headers:

| Header | Value |
|--------|-------|
| `X-Emote-Version` | `1` |
| `X-Emote-State` | Selected state, e.g. `think` |
| `X-Emote-Frame` | Selected filename, e.g. `think.png` |
| `X-Emote-Set` | Actual set directory basename, never its path |
| `X-Emote-Stream-Id` | Random UUID per sender lifetime |
| `X-Emote-Sequence` | Increasing positive integer (1–20 digits), assigned per request |

Identifiers must match `[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}`. Unsupported custom names are skipped and reported without affecting local rendering. Delivery/configuration errors are reported as warnings; diagnostics never include payloads or the destination URL.

## Create your own avatar

The Gentleman is just the default set: swap in your own character without touching the extension.

### 1. Make the frames

One folder per set, one subfolder of PNG frames per state:

```
my-avatar/
├── emotes.json            # optional: timing and special frames
├── idle/idle.png          # resting pose (required)
├── idle/idle_blink.png    # optional blink
├── think/think.png
├── talk/talk_close.png    # talk_small.png, talk_mid.png, talk_wide.png
├── hi/hi_01.png           # animated states: frames play in filename order
├── hi/hi_02.png
└── ...                    # any state from the table above
```

- **Required:** only `idle`. A missing state just doesn't animate, so you can start small and add scenes later.
- **Size:** any size fits, because the image is scaled to the frame. Small pixel art such as 48×40 keeps it crisp.
- **Frame order:** frames play in alphabetical order, so zero-pad the names (`_01`, `_02`…). Frames named `in_*` play once, then the other frames of that state loop; the greeting uses that for the landing.
- **Transparency:** use a transparent background; the frame and the terminal show through.
- **Accent color:** pixels painted exactly `#ff00ff` (base), `#aa00aa` (shade) or `#ff80ff` (light) follow the accent color, like the Gentleman's rose.

### 2. Tune the timing (optional)

`emotes.json` sets how each state plays. Copy `emotes/gentleman/emotes.json` as a starting point:

```json
{
  "idle": { "default": "idle.png", "blink": "idle_blink.png" },
  "talk": { "weights": { "talk_close.png": 1, "talk_small.png": 3, "talk_mid.png": 3, "talk_wide.png": 1 } },
  "cycle": { "hi": "loop", "read": "pingpong" },
  "frameMs": { "hi": 300, "read": 450 }
}
```

`cycle` is `"loop"` (1-2-3-1-2-3) or `"pingpong"` (1-2-3-2-1). `frameMs` is the time per frame in milliseconds.

### 3. Install it and select it

Put the folder in one of these places:

- `<agent dir>/extensions/gentle-emote/emotes/my-avatar/`: for you, in every project.
- `.pi/extensions/gentle-emote/emotes/my-avatar/`: only for that project, so you can commit it for your team.

Then select it in your `config.json`:

```json
{
  "emotes": [{ "model": "*", "emote-set": "my-avatar" }]
}
```

Run `/reload` and `/emote demo` to check every state.

### Different avatars per model

Entries are glob patterns against the model ID and/or thinking level. The last match wins:

```json
{
  "emotes": [
    { "model": "*", "emote-set": "gentleman" },
    { "model": "*haiku*", "emote-set": "my-avatar" },
    { "thinking-level": "high", "emote-set": "focused-avatar" }
  ]
}
```

### A YOLO look for your avatar

Ship a twin set named `<your-set>-yolo` (for example `my-avatar-yolo/`) next to it. While Gentle Shell's YOLO or Super YOLO mode is on, every frame comes from the twin instead; states missing there simply don't animate, so copy the whole set. The rest pose is `<set>/yolo/yolo.png` for the rocket and `<set>/super-yolo/super-yolo.png` for the sun. Without a twin, your avatar keeps its normal look.

### Text-only avatars

For terminals without images, a set can be plain text: add an `ascii.yaml` instead of PNGs. See `emotes/ascii/ascii.yaml` for the format.

### Drawing with code

The Gentleman is not hand-drawn: `scripts/sprites/` generates every frame from code, and `npm run sprites` rebuilds it. To build your character the same way, clone the repo, copy `scripts/sprites/`, change the shapes and colors, and point the output to your set's folder.

## Terminals

| Terminal | Renderer | Status |
|----------|----------|--------|
| Ghostty, kitty, WarpTerminal | kitty Unicode placeholders | ✅ Crisp image in a frame |
| tmux (inside Ghostty or kitty) | kitty Unicode placeholders | ✅ Needs `set -g allow-passthrough on` |
| iTerm2, WezTerm | iTerm2 images | ⚠️ Works, less tested |
| Zellij, screen, others | ASCII | Fallback only |

For tmux, add this to `tmux.conf` and restart the tmux server:

```bash
set -g allow-passthrough on
set -ga update-environment TERM
set -ga update-environment TERM_PROGRAM
set -sg escape-time 0
```

Force a renderer with `terminals`:

```json
{ "terminals": [{ "match": "tmux", "render": "kitty-unicode" }] }
```

Valid `render` values: `"auto"`, `"kitty-unicode"`, `"kitty"`, `"iterm2"`, `"ascii"`.

## Limitations

- Sitting beside the prompt relies on Pi's internal layout. If a future version changes it, the avatar falls back to above the editor.
- YOLO and Super YOLO detection uses Gentle Shell's internal channel: it only reads the mode, never toggles it. In other hosts neither look shows.
- `bye` plays when you say goodbye, not when the process quits (a quit clears the screen right away).
- Zellij has no image passthrough, so it gets the ASCII fallback.

## Contributing

Open an issue first and wait for the `approved` label. A pull request has to point at that issue with `Closes #N` and needs an approving review. Only the maintainer merges. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Built on [pi-emote](https://github.com/cgxeiji/pi-emote) by Eiji Onchi ([@cgxeiji](https://github.com/cgxeiji)): the animator, renderers and terminal detection come from there. The Gentleman avatar, the framed layout beside the prompt and the Gentle Shell scenes were added in this fork.

## License

MIT. See [LICENSE](LICENSE).
