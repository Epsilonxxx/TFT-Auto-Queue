# TFT-Auto-Queue

React + Tailwind desktop app for TFT auto queue in Tocker's Trials.

## Features

- F1 global hotkey to toggle auto queue
- Random 1-2 second delay for matchmaking/accept actions
- Auto accept ready-check
- Auto continue after game ends
- Cycle counter
- Log history limited to 50 lines

## Run

```powershell
cd D:\tft-auto-queue-next
npm install
npm run start
```

## Build Installer

```powershell
npm run dist
```

Installer output:

`D:\tft-auto-queue-next\release\TFT Auto Queue Setup 0.2.0.exe`
