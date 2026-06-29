# CLAUDE.md — BGS-Nexus-automation

This is a Hermes Agent skill. See [AGENTS.md](AGENTS.md) for the governing contract and [SKILL.md](SKILL.md) for the full operational specification.

## Purpose

Browser automation for Nexus Mods — Skyrim Special Edition section. Uses a real Chrome browser via CDP (Chrome DevTools Protocol) with the user's login profile, zero Puppeteer/Playwright dependency.

## Core Commands

| Command | Description |
|---------|-------------|
| `node scripts/init-browser.js` | Launch Chrome with CDP on port 9222 |
| `node scripts/nexus-automation.js status` | Check login state |
| `node scripts/nexus-automation.js trending [page]` | 7-day trending mods |
| `node scripts/nexus-automation.js search <kw> [...opts]` | Search mods |
| `node scripts/nexus-automation.js tracking [action] [q] [p]` | Tracking centre |
| `node scripts/nexus-automation.js history [q] [p] [action]` | Download history |
| `node scripts/nexus-automation.js api-keys` | Read MO2 API keys (read-only) |

## Key Constraints

1. **ES5 only in evaluate()**: `var`, `function(){}`, no `const`/`let`/`?.`/arrow functions — Nexus pages throw SyntaxError on ES6
2. **No Puppeteer/Playwright**: Pure CDP over WebSocket (`ws` module)
3. **`Input.dispatchMouseEvent`** for React event handlers, `element.click()` for Magnific Popups
4. **Never create API keys** — refuse and direct user to nexusmods.com/settings/api-keys
5. **Next.js pages need 5s delay** after navigation before DOM queries
