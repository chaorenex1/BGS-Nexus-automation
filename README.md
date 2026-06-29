# BGS-Nexus-automation

Browser automation for Nexus Mods via Chrome DevTools Protocol — human-like browsing of the Skyrim Special Edition section, including search, tracking, endorsement, download, and more.

## Features

| # | Feature | Command |
|---|---------|---------|
| 1 | Trending Mods (7 days) | `trending [page]` |
| 2 | Search Mods | `search <keyword> [options]` |
| 3 | Mod Details | `details <modId>` |
| 4 | Track / Endorse / Vote | `track` / `endorse` / `vote <modId>` |
| 5 | Tags & Gallery | `tags` / `gallery <modId>` |
| 6 | Description Summary | `description <modId>` |
| 7 | Files Tab | `files <modId>` |
| 8 | Posts Tab (comments + nested replies) | `posts <modId> [keyword] [page]` |
| 9 | Bugs Tab | `bugs <modId> [keyword]` |
| 10 | Download Mod | `download <modId> <fileName> <version> [type]` |
| 11 | Tracking Centre | `tracking [action] [query] [page]` |
| 12 | Download History | `history [query] [page] [action]` |
| 13 | MO2 API Keys (read-only) | `api-keys` |
| 14 | Post Comment | `post <modId> "<content>"` |
| 15 | Bug Comments | `bug-comments <modId>` |

## Prerequisites

- Node.js >= 18
- Windows 10
- Nexus Mods account (login required for most operations)

## Installation

### Let your AI agent install this skill

When your Hermes Agent encounters a task involving Nexus Mods — browsing mods, tracking, endorsing, downloading, or managing your modding workflow — tell it:

> Install the BGS-Nexus-automation skill from GitHub:
> `https://raw.githubusercontent.com/chaorenex1/BGS-Nexus-automation/master/SKILL.md`

The agent will run the equivalent of:

```bash
hermes skills install https://raw.githubusercontent.com/chaorenex1/BGS-Nexus-automation/master/SKILL.md
```

Once installed, the skill auto-loads whenever you ask the agent to interact with Nexus Mods. No manual configuration needed — the skill knows how to launch Chrome, connect via CDP, and prompt you for login.

### Manual / Standalone

```bash
git clone https://github.com/chaorenex1/BGS-Nexus-automation.git
cd BGS-Nexus-automation
npm install
```

## Quick Start

```bash
# 1. Start browser + CDP session
node scripts/init-browser.js

# 2. Login in the opened Chrome window → reply "已登录"

# 3. Verify login state
node scripts/nexus-automation.js status

# 4. Use any feature
node scripts/nexus-automation.js trending 1
node scripts/nexus-automation.js search skyui
node scripts/nexus-automation.js details 183263
```

## Architecture

- **CDP native**: Direct WebSocket connection to Chrome DevTools Protocol — no Puppeteer/Playwright dependency
- **Real browser**: Uses `@puppeteer/browsers` to manage Chrome, runs in visible mode with user profile
- **ES5 constraint**: All `Runtime.evaluate` expressions use ES5 syntax to avoid Nexus-specific parser issues
- **Human simulation**: Random delays, smooth scrolling, real mouse events via `Input.dispatchMouseEvent`

## Safety

- Never saves credentials, passwords, or API keys
- API key creation is **refused** — must be done manually on nexusmods.com
- Write operations (download, endorse, vote, comment) require explicit user confirmation
- All data is session-scoped, cleared after session ends

## Documentation

- Full skill specification: [SKILL.md](SKILL.md)
- CDP pitfalls & patterns: [references/cdp-pitfalls.md](references/cdp-pitfalls.md)
- DOM structure references: [references/](references/)

## License

This skill is part of the Hermes Agent ecosystem by Nous Research.
