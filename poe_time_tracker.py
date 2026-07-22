r"""
poe_time_tracker.py

Interactive Path of Exile Client.txt zone-entry timer.

Run it with no arguments:
    python poe_time_tracker.py

The first time it runs, it will ask you to set (or accept the default)
Client.txt path. After that, your client path, default run-gap, and
default long-stop threshold are remembered in a small config file, so
you just get the main menu every time.

Config file location:
    %APPDATA%\PoETimeTracker\config.json
"""

import csv
import json
import os
import re
import sys
from datetime import datetime, timedelta

# Enable ANSI escape code processing on older Windows cmd.exe (Windows 10+
# terminals and Windows Terminal already support this; this is a no-op there).
if os.name == "nt":
    os.system("")

RED = "\033[91m"
RESET = "\033[0m"

DEFAULT_CLIENT_PATH = r"C:\Program Files (x86)\Steam\steamapps\common\Path of Exile\logs\Client.txt"
DEFAULT_GAP = 30
DEFAULT_THRESHOLD = 6

CONFIG_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "PoETimeTracker")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")

# Matches lines like:
# 2026/07/22 15:06:15 27991968 cffb06dd [INFO Client 5828] : You have entered The Ebony Barracks.
LINE_PATTERN = re.compile(
    r"^(?P<date>\d{4}/\d{2}/\d{2})\s+"
    r"(?P<time>\d{2}:\d{2}:\d{2})\s+"
    r"(?P<ms>\d+)\s+"
    r"(?P<hash>[0-9a-fA-F]+)\s+"
    r"\[(?P<level>[^\]]+)\]\s*:\s*"
    r"(?P<message>.*)$"
)

# Only zone-entry lines are kept.
ZONE_ENTRY_PATTERN = re.compile(r"^You have entered\s+(?P<zone>.+?)\.?$", re.IGNORECASE)


# ------------------------- config -------------------------

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_config(cfg):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def is_setup(cfg):
    return "client_path" in cfg


def first_time_setup(cfg):
    print("It looks like this is your first time running this tool.\n")
    answer = input(
        f"Do you want to set a custom Client.txt path?\n"
        f"(Default: {DEFAULT_CLIENT_PATH}) [y/N]: "
    ).strip().lower()

    if answer.startswith("y"):
        path = input("Enter path to Client.txt: ").strip().strip('"')
        cfg["client_path"] = path
    else:
        cfg["client_path"] = DEFAULT_CLIENT_PATH

    cfg.setdefault("gap", DEFAULT_GAP)
    cfg.setdefault("threshold", DEFAULT_THRESHOLD)
    save_config(cfg)
    print()


# ------------------------- parsing -------------------------

def parse_line(line):
    """Return a dict with datetime + zone if the line is a zone entry, else None."""
    match = LINE_PATTERN.match(line.strip())
    if not match:
        return None

    zone_match = ZONE_ENTRY_PATTERN.match(match.group("message").strip())
    if not zone_match:
        return None

    dt = datetime.strptime(
        f"{match.group('date')} {match.group('time')}", "%Y/%m/%d %H:%M:%S"
    )
    return {"datetime": dt, "zone": zone_match.group("zone")}


def format_delta(delta):
    """Format a timedelta as H:MM:SS (or MM:SS if under an hour)."""
    total_seconds = int(delta.total_seconds())
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def load_entries(logfile):
    try:
        with open(logfile, "r", encoding="utf-8", errors="ignore") as f:
            raw_lines = f.readlines()
    except FileNotFoundError:
        print(f"Error: file not found -> {logfile}")
        return None

    entries = []
    for raw in raw_lines:
        parsed = parse_line(raw)
        if parsed:
            entries.append(parsed)
    return entries


def available_dates(entries):
    seen = []
    for e in entries:
        d = e["datetime"].date()
        if d not in seen:
            seen.append(d)
    return seen


def group_into_runs(entries, gap_minutes):
    """Split a chronological list of entries into runs, starting a new run
    whenever the gap since the previous entry exceeds gap_minutes."""
    if not entries:
        return []

    runs = [[entries[0]]]
    threshold = timedelta(minutes=gap_minutes)
    for entry in entries[1:]:
        if entry["datetime"] - runs[-1][-1]["datetime"] > threshold:
            runs.append([entry])
        else:
            runs[-1].append(entry)
    return runs


def print_run_detail(run, threshold_minutes):
    threshold = timedelta(minutes=threshold_minutes)
    print()
    print(f"{'Timestamp':<20} {'Delta':>10}   Zone")
    print("-" * 70)
    previous_dt = None
    for entry in run:
        dt = entry["datetime"]
        delta = dt - previous_dt if previous_dt else None
        delta_str = format_delta(delta) if delta else "--"

        is_long = delta is not None and delta > threshold
        line = f"{dt:%Y-%m-%d %H:%M:%S} {delta_str:>10}   {entry['zone']}"
        if is_long:
            print(f"{RED}{line}  <-- LONG STOP{RESET}")
        else:
            print(line)

        previous_dt = dt
    print("-" * 70)
    span = run[-1]["datetime"] - run[0]["datetime"]
    print(f"Entries: {len(run)}   Run duration: {format_delta(span)}")


def write_csv(run, path, threshold_minutes):
    threshold = timedelta(minutes=threshold_minutes)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["timestamp", "delta_seconds", "delta_formatted", "long_stop", "zone"])
        writer.writeheader()
        previous_dt = None
        for entry in run:
            dt = entry["datetime"]
            delta = dt - previous_dt if previous_dt else timedelta(0)
            writer.writerow({
                "timestamp": dt.strftime("%Y-%m-%d %H:%M:%S"),
                "delta_seconds": int(delta.total_seconds()),
                "delta_formatted": format_delta(delta),
                "long_stop": "YES" if delta > threshold else "",
                "zone": entry["zone"],
            })
            previous_dt = dt
    print(f"CSV written to: {path}")


# ------------------------- menu actions -------------------------

def parse_runs_flow(cfg):
    entries = load_entries(cfg["client_path"])
    if entries is None:
        input("Press Enter to return to the menu...")
        return
    if not entries:
        print("No zone-entry lines found in the log.")
        input("Press Enter to return to the menu...")
        return

    dates = available_dates(entries)
    print("\nDates found in the log:")
    for i, d in enumerate(dates, 1):
        count = sum(1 for e in entries if e["datetime"].date() == d)
        print(f"  {i}. {d.isoformat()}  ({count} entries)")

    date_input = input("\nWhich date do you want? (number, date YYYY/MM/DD, or 'all'): ").strip()

    if date_input.lower() == "all":
        day_entries = entries
    elif date_input.isdigit() and 1 <= int(date_input) <= len(dates):
        chosen_date = dates[int(date_input) - 1]
        day_entries = [e for e in entries if e["datetime"].date() == chosen_date]
    else:
        try:
            chosen_date = datetime.strptime(date_input, "%Y/%m/%d").date()
        except ValueError:
            print("Could not understand that date.")
            input("Press Enter to return to the menu...")
            return
        day_entries = [e for e in entries if e["datetime"].date() == chosen_date]

    if not day_entries:
        print("No entries found for that date.")
        input("Press Enter to return to the menu...")
        return

    gap = cfg.get("gap", DEFAULT_GAP)
    threshold = cfg.get("threshold", DEFAULT_THRESHOLD)
    runs = group_into_runs(day_entries, gap)

    print(f"\nFound {len(runs)} run(s) (a new run starts after a gap of {gap}+ minutes):")
    for i, run in enumerate(runs, 1):
        start = run[0]["datetime"]
        end = run[-1]["datetime"]
        print(f"  {i}. {start:%H:%M:%S} - {end:%H:%M:%S}  "
              f"({len(run)} entries, duration {format_delta(end - start)})")

    run_input = input("\nWhich run do you want to see? (number, or 'all'): ").strip()

    if run_input.lower() == "all":
        chosen_runs = runs
    elif run_input.isdigit() and 1 <= int(run_input) <= len(runs):
        chosen_runs = [runs[int(run_input) - 1]]
    else:
        print("Could not understand that selection.")
        input("Press Enter to return to the menu...")
        return

    for run in chosen_runs:
        print_run_detail(run, threshold)

    save_choice = input(
        "\nSave this to a CSV file? Type a file name to save, or leave blank to skip: "
    ).strip().strip('"')
    if save_choice:
        if not save_choice.lower().endswith(".csv"):
            save_choice += ".csv"
        combined = [entry for run in chosen_runs for entry in run]
        write_csv(combined, save_choice, threshold)

    input("\nPress Enter to return to the menu...")


def options_menu(cfg):
    while True:
        print("\n--- Options ---")
        print(f"1. Set Client file            (current: {cfg['client_path']})")
        print(f"2. Set default gap             (current: {cfg.get('gap', DEFAULT_GAP)} minutes)")
        print(f"3. Set default long-stop time  (current: {cfg.get('threshold', DEFAULT_THRESHOLD)} minutes)")
        print("4. Back")

        choice = input("Choose an option: ").strip()

        if choice == "1":
            new_path = input("Enter new path to Client.txt: ").strip().strip('"')
            if new_path:
                cfg["client_path"] = new_path
                save_config(cfg)
                print("Client path updated.")
        elif choice == "2":
            new_gap = input("Enter new run gap in minutes: ").strip()
            if new_gap.isdigit():
                cfg["gap"] = int(new_gap)
                save_config(cfg)
                print("Default gap updated.")
            else:
                print("Please enter a whole number.")
        elif choice == "3":
            new_threshold = input("Enter new long-stop threshold in minutes: ").strip()
            if new_threshold.isdigit():
                cfg["threshold"] = int(new_threshold)
                save_config(cfg)
                print("Default threshold updated.")
            else:
                print("Please enter a whole number.")
        elif choice == "4":
            return
        else:
            print("Invalid choice.")


def main_menu(cfg):
    while True:
        print("\n--- Path of Exile Time Tracker ---")
        print("1. Parse run(s)")
        print("2. Options")
        print("3. Exit")

        choice = input("Choose an option: ").strip()

        if choice == "1":
            parse_runs_flow(cfg)
        elif choice == "2":
            options_menu(cfg)
        elif choice == "3":
            sys.exit(0)
        else:
            print("Invalid choice.")


def main():
    cfg = load_config()

    if not is_setup(cfg):
        first_time_setup(cfg)

    main_menu(cfg)


if __name__ == "__main__":
    main()