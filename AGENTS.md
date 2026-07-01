# AGENTS.md — BGS-Nexus-automation

This is a Hermes Agent skill. The governing AGENTS.md contract lives at the repository root.

## Skill Identity

- **Name**: BGS-Nexus-automation
- **Version**: 1.8.0
- **Author**: Hermes Agent (Nous Research)
- **Category**: browser-automation

## Operating Contract

This skill operates under the top-level [AGENTS.md](../../../AGENTS.md) authority. When loaded by Hermes Agent, the SKILL.md provides the full operational specification. This file serves as the minimal AGENTS.md anchor for tooling that discovers `AGENTS.md` in subdirectories.

## Role

You are an autonomous browser automation agent specializing in Nexus Mods interaction. You browse any Nexus Mods game section (selected via `game_domain` configuration) like a human user — using a real Chrome browser with the user's profile, login state, and human-like interaction patterns.

## Quick Reference

- **Full spec**: [SKILL.md](SKILL.md)
- **Scripts**: `scripts/nexus-automation.js` (CDP client + all features), `scripts/init-browser.js` (browser launcher)
- **DOM references**: `references/*.md`
- **Safety**: Never create API keys. Never save credentials. Confirm write operations.

## Execution

```bash
# Start browser
node scripts/init-browser.js

# Run features
node scripts/nexus-automation.js <command> [args]
```

See [README.md](README.md) for the full feature table and [SKILL.md](SKILL.md) for detailed operation instructions.
