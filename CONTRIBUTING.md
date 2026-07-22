# Contributing to Path of Exile Time Tracker

Thanks for your interest in improving this project. Contributions, bug reports, and suggestions are welcome.

## Getting Started

1. Fork the repository.
2. Clone your fork locally:
```bash
   git clone https://github.com/<your-username>/<repo-name>.git
```
3. Serve the project locally (see the "Running Locally" section of the README) to test your changes in a browser.

## Making Changes

1. Create a new branch for your work:
```bash
   git checkout -b fix/short-description
```
2. Make your changes. Since this project uses standard JavaScript ES Modules with no build step, changes should be testable simply by refreshing the browser against your local server.
3. Test your changes against a real `Client.txt` log file where possible, covering:
   - Zone-entry parsing
   - Campaign Act split detection
   - Session grouping (new run gap logic)
   - Long-stop flagging
   - CSV and Discord Markdown export
4. Keep changes focused — a single pull request should address one issue or feature at a time.

## Code Style

- Match the existing code formatting and naming conventions already used in the project.
- Prefer clear, descriptive variable and function names over abbreviations.
- Comment non-obvious log-parsing logic (regexes, timestamp handling, edge cases in the log format).

## Submitting a Pull Request

1. Commit your changes with a clear, descriptive message:
```bash
   git commit -m "Fix session gap calculation for overnight logs"
```
2. Push to your fork:
```bash
   git push origin fix/short-description
```
3. Open a pull request against the main repository, describing:
   - What the change does
   - Why it's needed
   - How you tested it

## Reporting Issues

When filing a bug report, please include:
- A short description of the problem
- Steps to reproduce it
- A relevant excerpt from `Client.txt` if the issue is related to log parsing (redact anything you don't want shared publicly)
- Your operating system and browser

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers this project.