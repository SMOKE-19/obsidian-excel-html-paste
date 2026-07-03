# Excel HTML Paste

[한국어](README.ko.md)

Excel HTML Paste is an Obsidian plugin that stores tables copied from Excel as managed assets in your vault. It reads `text/html` and `image/png` from the clipboard, saves them under the vault, and inserts a code block that points to the managed asset.

## Features

- Adds an editor context-menu command: `Excel 표(HTML) 붙여넣기`
- Stores the original Excel HTML as `table.html`
- Stores the clipboard image as `table.png` when available
- Creates a searchable Markdown index file, `table.search.md`
- Renders `excel-html-asset` code blocks as image previews in Reading view
- Provides an `HTML` button on rendered assets to copy the original HTML back to the clipboard
- Provides rendered-asset context-menu actions for history-preserving replacement, full replacement, and deletion
- On Windows, improves CF_HTML read/write behavior through a native clipboard helper

## UX With And Without The Windows Helper

The plugin can be used without the helper. The helper is not required for the basic asset workflow. However, on Windows, round-tripping Excel HTML formatting is most reliable when the helper is available.

The helper is a small Rust native executable. It directly reads and writes the Windows `HTML Format` clipboard format, also known as CF_HTML. CF_HTML is not just a plain HTML string. It includes Windows-specific offset headers such as `StartHTML`, `EndHTML`, `StartFragment`, and `EndFragment`. Excel often handles this format more consistently than standard browser `text/html` clipboard data.

### Without The Helper

- `Excel 표(HTML) 붙여넣기` reads `text/html` and `image/png` through the browser/Electron Clipboard API.
- Asset creation, image preview, `table.html`, `table.search.md`, replacement, and deletion still work.
- The `HTML` button writes `text/html` and `text/plain` through the standard Clipboard API.
- Copying HTML into browsers, mail clients, and document editors will usually work.
- Pasting back into Excel is environment-dependent. The table structure may survive, but formatting, merged cells, widths, colors, or Excel-specific details may be degraded.
- If the helper is missing or fails, the plugin automatically falls back to this path and shows a `Notice` when possible.

### With The Helper

- On Windows Desktop, when the helper executable is found, the plugin first reads Excel clipboard HTML through the native CF_HTML path.
- When the `HTML` button is clicked, the saved HTML is written directly to the Windows `HTML Format` clipboard format.
- The helper also sets `CF_UNICODETEXT`, `CF_TEXT`, and `CF_OEMTEXT` fallback formats to improve paste compatibility with non-Excel applications.
- Pasting back into Excel is more likely to preserve table structure and HTML formatting than the helperless path.
- The helper is used only on Windows. On macOS, Linux, or Windows installations without the helper, the plugin falls back to the standard Clipboard API.

### Practical Difference

| Task | Without helper | With helper |
| --- | --- | --- |
| Save an Excel table into Obsidian | Works | Works |
| Render image previews | Works | Works |
| Create `table.search.md` | Works | Works |
| Replace/delete managed assets | Works | Works |
| Copy HTML into browsers or document apps | Usually works | Usually works |
| Paste HTML back into Excel | Environment-dependent | More reliable |
| Preserve Excel-like formatting round-trip | Hard to guarantee | Recommended path |

In short, the helper is an optional component for improving **Windows Excel formatting round-trip quality**. It is not required for the core asset storage workflow.

## Usage Flow

Copy a table from Excel, right-click in the Obsidian editor, and choose `Excel 표(HTML) 붙여넣기`.

The plugin creates an asset folder in the vault and inserts a code block into the current note.

```text
assets/excel-paste/{id}/
  meta.json
  table.html
  table.png
  table.search.md
```

The inserted note content looks like this:

````markdown
```excel-html-asset
path: assets/excel-paste/{id}/meta.json
```
````

In Reading view, this code block is rendered as an Excel table image preview. If no image exists, the renderer shows an HTML-only fallback message.

## Asset Management

Right-click a rendered Excel asset to access these actions:

- `이력 남기고 Excel 표(HTML) 교체`: Archives the current `table.html`, `table.png`, `table.search.md`, and `meta.json` with timestamped filenames, then replaces the active files with the current clipboard content.
- `Excel 표(HTML) 완전 교체`: Overwrites the active files with the current clipboard content and deletes previous history files.
- `Excel asset 삭제`: Removes the code block from the note and deletes the linked asset folder.

Replacement operations include rollback handling where possible, so existing files are restored if replacement fails partway through.

## Project Structure

- `main.ts`: Obsidian plugin entrypoint, clipboard handling, asset creation/rendering/replacement/deletion logic
- `styles.css`: Styles for rendered Excel images, the HTML copy button, fallback states, and error states
- `manifest.json`: Obsidian plugin metadata
- `esbuild.config.mjs`: Bundles `main.ts` into `main.js`
- `helper/`: Rust native helper for Windows CF_HTML read/write support
- `bin/`: Target location for packaged native helper executables

## Build

Install dependencies.

```bash
npm install
```

Build the Obsidian plugin JavaScript.

```bash
npm run build
```

Building the Windows native helper requires the Rust toolchain.

```bash
npm run build:helper:win64
```

Place the built helper executable at this path before packaging.

```text
bin/excel-html-clipboard-win32-x64.exe
```

The arm64 Windows helper should use this filename.

```text
bin/excel-html-clipboard-win32-arm64.exe
```

## Installation

Download the `excel-html-paste-plugin` artifact from GitHub Actions or Releases. After extracting it, the folder should look like this:

```text
excel-html-paste/
  manifest.json
  main.js
  styles.css
  bin/
    excel-html-clipboard-win32-x64.exe
```

Place the extracted `excel-html-paste/` folder under your vault plugin directory.

```text
.obsidian/plugins/excel-html-paste/
  manifest.json
  main.js
  styles.css
  bin/
    excel-html-clipboard-win32-x64.exe
```

After placing the files, refresh the Community Plugins list in Obsidian and enable `Excel HTML Paste`.

Releases may also include individual `manifest.json`, `main.js`, and `styles.css` files for Obsidian community plugin compatibility. For manual installation, the plugin artifact is usually easier to use.

The Windows native clipboard helper is optional. The basic installation and paste workflow do not require the helper executable. Add the helper when you want more reliable Excel CF_HTML clipboard read/write behavior on Windows.

```text
excel-html-paste/
  bin/
    excel-html-clipboard-win32-x64.exe
```

Inside a vault, that becomes:

```text
.obsidian/plugins/excel-html-paste/
  manifest.json
  main.js
  styles.css
  bin/
    excel-html-clipboard-win32-x64.exe
```

The repository `bin/` directory contains only a `.gitkeep` placeholder. This is fine for basic installation. Build and place the actual helper executable only when needed.

The `excel-html-paste-plugin` artifact produced by GitHub Actions includes the Windows x64 helper. If you clone the repository and build it yourself, run `npm run build:helper:win64` and copy the resulting executable to `bin/excel-html-clipboard-win32-x64.exe`.

## Behavior Notes

- The plugin is desktop-only.
- If the clipboard does not contain `text/html`, paste is aborted.
- If the clipboard does not contain an image, only the HTML source and searchable Markdown index are stored.
- Generated assets are restricted to `assets/excel-paste/`.
- `table.search.md` is a sidecar Markdown file that converts HTML table content into Markdown table text so Obsidian search can index it.
