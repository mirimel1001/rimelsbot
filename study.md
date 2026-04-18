# 🧠 Rimels-Bot Architecture & Study Guide

This document outlines the core patterns and logic used in this Discord bot. Use this as a reference when adding new games or commands to ensure consistency.

---

## 🎮 Game Categorization

When adding a new game, classify it into one of these two categories:

### 1. Betting Games (e.g., HighLow)
*   **Mechanism**: The user provides an `amount` (bet) as an argument.
*   **Prize**: Based directly on the user's bet (e.g., 2x payout).
*   **Probability**: Uses `winning_rates.json` to allow admins to adjust win chances based on roles.
*   **Restriction**: These games **skip** the `prize_configs.json` system.

### 2. Reward Games (e.g., ImageGuess)
*   **Mechanism**: The user initiates a game without a mandatory bet.
*   **Prize**: A random amount calculated by the bot.
*   **Configuration**: Uses `prize_configs.json` to determine the `[Min]` and `[Max]` rewards for the server.
*   **Default Logic**: Should always have a hardcoded fallback range (e.g., 300-600) in the game code if no configuration exists.

---

## 📂 Configuration & Data Storage

### 🛡️ Security & Environment
*   **`.env`**: Stores all sensitive keys (`DISCORD_TOKEN`, `PIXABAY_KEY`, `UNB_TOKEN`). Never hardcode these.
*   **.gitignore**: Always include `.env` and any `.json` files that store guild-specific data to prevent them from being overwritten during pulls.

### ⚙️ JSON Data Mapping
| File | Purpose | Key Property |
| :--- | :--- | :--- |
| `server_config.json` | General bot settings like `prefix`. | Checked on every message. |
| `server_winning_rates.json` | Probability overrides for betting games. | Mapped by `guildId` -> `gameName` -> `roleId`. |
| `server_prize_configs.json` | Random reward ranges for non-betting games. | Mapped by `guildId` -> `gameName` -> `{min, max}`. |
| `server_game_settings.json` | General game settings (Delays, Game Channels). | Mapped by `guildId` -> `delays/gameChannel`. |
| `server_prefixes.json` | Custom server prefixes. | Mapped by `guildId`. |
| `.env` | Private API Keys (Discord, UNB, Pixabay). | Loaded at startup. |

---

## ⏳ Cooldown & Restriction System

The bot implements per-user cooldowns and per-server channel restrictions.
*   **Settings**: Stored in `game_settings.json`.
*   **Channel Restriction**: Controlled by `rgamechannel [#channel | clear]`.
*   **Enforcement**: Centralized in `index.js`. Any command with `category: 'minigame'` is automatically filtered.
*   **Active Tracking**: Cooldowns tracked in `client.cooldowns` (In-memory).

---

## 📋 Command Standards

### 1. Usage Format
All variable placeholders in `usage` strings and help messages must use square brackets: `[variable]`.
*   **Correct**: `rsc [game name] [Min] [Max]`
*   **Incorrect**: `rsc <game name> <Min> <Max>`

### 2. Permissions
*   **Admin Commands**: (e.g., `setprefix`) Use `PermissionsBitField.Flags.Administrator`.
*   **Config Commands**: (e.g., `winningrate`, `setcash`) Use `PermissionsBitField.Flags.ManageGuild` or `ManageRoles`.

---

## 🚀 How to Add a New Game
1.  **Identify Category**: Is it a bet or a reward?
2.  **Add Configuration Support**: 
    *   If Reward: Update the game to check `prize_configs.json`.
    *   If Betting: Update the game to check `winning_rates.json`.
3.  **Implement Fallbacks**: Always provide a default win rate (e.g., 50%) or default prize range (e.g., 300-600) in case the JSON is missing or unconfigured.
4.  **Update `setcash.js`**: If the new game is a betting game, add it to the `bettingGames` list to prevent manual prize overrides.

---

## 🛠️ Development Workflow

*   **Automatic Git Operations**: Upon completion of any task or set of changes, the AI assistant should automatically stage (`git add .`), commit, and push (`git push`) the updates to the GitHub repository. Each commit must include a **short but informative note** (commit message) that clearly describes what changes were made. This ensures the version history is easy to track and the hosting environment (Wispbyte) can be updated immediately via Git Pull.
