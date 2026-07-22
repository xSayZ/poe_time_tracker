# Path of Exile Time Tracker

A web-based tool that parses your Path of Exile `Client.txt` log file to analyze zone entries, calculate continuous play sessions, and track campaign act split times.

Everything runs entirely inside your browser. Your log file is processed locally and is never uploaded to any remote server.

## Features

- **Zone-entry parsing** — Isolates `You have entered <Zone>` log lines while filtering out chat messages, deaths, and system text.
- **Campaign Act splits** — Automatically detects campaign progression from Act 1 through Act 10 into Endgame Maps, recording split durations and character levels.
- **Automatic session grouping** — Splits raw log data into distinct play runs whenever inactivity exceeds a configurable gap (default: 30 minutes).
- **Long-stop identification** — Flags gaps between zone entries longer than a set threshold (default: 6 minutes) to easily spot AFK time, town breaks, or difficult encounters.
- **Discord & CSV export** — Generates formatted Markdown summaries styled for Discord sharing, as well as CSV exports for spreadsheet analysis.
- **Client location helper** — Includes quick-copy directory paths for standard Windows, Linux (Proton), and macOS game installations.

## Running Locally

Because the application uses standard JavaScript ES Modules, it must be served over HTTP rather than opened directly via local file path (`file://`).

You can serve the project using any simple local server setup:

### Option A: VS Code

Install the Live Server extension, right-click `index.html`, and select **Open with Live Server**.

### Option B: Python

Open your terminal in the project directory and run:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in your browser.

### Option C: Node.js

Open your terminal in the project directory and run:

```bash
npx http-server -c-1
```

Then open the address provided in your terminal output.

## Usage

1. Open the application in your browser.
2. Set your desired **New Run Gap** and **Long Stop Threshold** values if you wish to adjust the default parameters.
3. Drag and drop your `Client.txt` file onto the dropzone (or click to select it).
4. Use the view selector to toggle between **Standard Session Runs** and **Campaign Act Splits**.
5. Filter zone entries, copy Markdown campaign summaries to your clipboard, or export session data to CSV.

## Finding Your Client.txt File

Common log paths by operating system:

### Windows (Standalone / Steam)

```
C:\Program Files (x86)\Grinding Gear Games\Path of Exile\logs\Client.txt
```

### Linux (Steam Proton)

```
~/.local/share/Steam/steamapps/compatdata/238960/pfx/drive_c/Program Files (x86)/Steam/steamapps/common/Path of Exile/logs/Client.txt
```

### macOS

```
~/Library/Application Support/Path of Exile/logs/Client.txt
```

## How Session Grouping Works

A session run is defined as a continuous sequence of zone transitions without an inactive gap exceeding your configured gap limit. When a gap larger than the threshold occurs (such as logging off or taking an extended break), a new run is initialized.

## License

MIT — Feel free to adapt and modify as needed.