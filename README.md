# TextDiff

Static, front-end only side-by-side text diff (HTML/CSS/JS).

Live: https://agent6.github.io/TextDiff/

## Features

- Side-by-side diff with line numbers
- Automatic padding blank lines to keep left/right aligned
- Line-level highlighting for added/removed/changed lines
- Inline highlighting for changed parts within a line
- Options to ignore case and normalize whitespace
- Paste-from-clipboard overlay when an input is empty

## Run

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.
