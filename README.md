# PoE Time Tracker

A small interactive command-line tool that reads your **Path of Exile** `Client.txt` log file, isolates zone-entry lines (`You have entered ...`), groups them into play "runs," and shows you the time spent between each zone change, flagging any unusually long stop in red.

No dependencies, no setup beyond Python. Just run it.

```
--- Path of Exile Time Tracker ---
1. Parse run(s)
2. Options
3. Exit
Choose an option:
```

## Features

- **Zone-entry only** - filters out deaths, chat, level-ups, and everything else in the log; only tracks `You have entered <Zone>` lines.
- **Automatic run detection** - splits a day's entries into separate "runs" whenever there's a gap of inactivity (default: 30 minutes), so distinct sessions on the same day aren't lumped together.
- **Long-stop highlighting** - any gap between two zone entries longer than a configurable threshold (default: 6 minutes) is printed in red with a `<-- LONG STOP` marker, so you can spot AFK time, tough fights, or backtracking at a glance.
- **Persistent settings** - your `Client.txt` path, default run gap, and long-stop threshold are saved to a config file after the first run, so you're not re-entering them every time.
- **CSV export** - save any parsed run to a `.csv` file for further analysis in Excel/Sheets.

## Requirements

- Python 3.7+
- Windows, macOS, or Linux (color output is tuned for Windows `cmd.exe` / Windows Terminal, but works cross-platform)

No external packages required - it only uses the Python standard library.

## Installation

1. Download `poe_time_tracker.py` from this repo.
2. Make sure Python is installed and available on your `PATH` (`python --version` to check).

## Usage

Run it with no arguments:

```cmd
python poe_time_tracker.py
```

### First run

You'll be asked whether you want to set a custom path to your `Client.txt`, or use the standard Steam install location:

```
Do you want to set a custom Client.txt path?
(Default: C:\Program Files (x86)\Steam\steamapps\common\Path of Exile\logs\Client.txt) [y/N]:
```

This choice, along with default settings, is saved so you won't be asked again.

### Main menu

```
1. Parse run(s)
2. Options
3. Exit
```

**Parse run(s)** walks you through:
1. Choose a date from the ones found in your log.
2. The log is split into runs based on your configured gap. Pick a run number, or `all`.
3. See a full breakdown of each zone entry, the time since the last one, and any long stops flagged in red.
4. Optionally save the result to a CSV file - type a file name (the `.csv` extension is added automatically) or leave it blank to skip.

**Options** lets you change and persist:
```
1. Set Client file            (current: ...)
2. Set default gap             (current: 30 minutes)
3. Set default long-stop time  (current: 6 minutes)
4. Back
```

## Configuration file

Your settings are stored at:

```
%APPDATA%\PoETimeTracker\config.json
```

Example contents:

```json
{
  "client_path": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile\\logs\\Client.txt",
  "gap": 30,
  "threshold": 6
}
```

Delete this file (or edit it directly) to reset the tool to first-run behavior.

## Example output

```
Dates found in the log:
  1. 2026-07-22  (5 entries)

Which date do you want? (number, date YYYY/MM/DD, or 'all'): 1

Found 1 run(s) (a new run starts after a gap of 30+ minutes):
  1. 15:06:15 - 15:22:00  (5 entries, duration 15:45)

Which run do you want to see? (number, or 'all'): 1

Timestamp                 Delta   Zone
----------------------------------------------------------------------
2026-07-22 15:06:15         --   The Ebony Barracks
2026-07-22 15:06:39      00:24   The Sarn Encampment
2026-07-22 15:08:17      01:38   The Ebony Barracks
2026-07-22 15:20:00      11:43   The Sarn Encampment  <-- LONG STOP
2026-07-22 15:22:00      02:00   The Ebony Barracks
----------------------------------------------------------------------
Entries: 5   Run duration: 15:45

Save this to a CSV file? Type a file name to save, or leave blank to skip:
```

*(In an actual terminal, the "LONG STOP" line renders in red.)*

## How "runs" are determined

A run is just a streak of zone entries with no gap longer than the configured minutes (30 by default) between any two consecutive entries. As soon as a bigger gap appears usually because you logged off, took a break, or alt-tabbed for a while, a new run starts. This is a simple heuristic, not an exact map-by-map breakdown, but it's a good approximation of "here's one continuous play session."

## License

MIT - do whatever you want with it.

## Contributing

Issues and pull requests welcome. A few ideas for future improvements:
- Per-zone time totals (e.g. total time spent in hideouts vs maps)
- Support for other log line types (deaths, level-ups) as optional overlays
- A `--reset-config` flag to clear saved settings without manually deleting the file