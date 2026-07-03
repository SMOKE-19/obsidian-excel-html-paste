# Excel HTML Paste

Excel에서 복사한 표를 Obsidian 문서에 관리형 asset으로 붙여넣는 Obsidian 플러그인입니다. 클립보드의 `text/html`과 `image/png`를 읽어 vault 안에 저장하고, 문서에는 asset을 가리키는 코드블럭을 삽입합니다.

## 주요 기능

- 편집기 우클릭 메뉴의 `Excel 표(HTML) 붙여넣기` 명령 제공
- Excel HTML 원본을 `table.html`로 저장
- 클립보드 이미지가 있으면 `table.png` 미리보기로 저장
- 검색용 Markdown 인덱스 `table.search.md` 생성
- 읽기 모드에서 `excel-html-asset` 코드블럭을 이미지 미리보기로 렌더링
- 렌더링된 asset의 `HTML` 버튼으로 원본 HTML을 서식 포함 클립보드에 복사
- 렌더링된 asset 우클릭 메뉴에서 이력 보관 교체, 완전 교체, 삭제 지원
- Windows 환경에서는 native clipboard helper를 통해 CF_HTML 읽기/쓰기를 보강

## Windows helper 유무에 따른 UX

이 플러그인은 helper 없이도 기본 기능을 사용할 수 있습니다. 다만 Windows에서 Excel과 HTML 서식을 왕복하는 품질은 helper가 있을 때 가장 안정적입니다.

helper는 작은 Rust native 실행 파일입니다. Windows의 `HTML Format` 클립보드 포맷, 즉 CF_HTML을 직접 읽고 씁니다. CF_HTML은 단순 HTML 문자열이 아니라 `StartHTML`, `EndHTML`, `StartFragment`, `EndFragment` 오프셋 헤더가 포함된 Windows 전용 클립보드 포맷입니다. Excel은 이 포맷을 브라우저 표준 `text/html`보다 안정적으로 해석하는 경우가 많습니다.

### helper가 없을 때

- `Excel 표(HTML) 붙여넣기`는 브라우저/Electron Clipboard API로 `text/html`과 `image/png`를 읽습니다.
- asset 생성, 이미지 미리보기, `table.html`, `table.search.md`, 교체/삭제 기능은 그대로 동작합니다.
- `HTML` 버튼은 표준 Clipboard API로 `text/html`과 `text/plain`을 클립보드에 씁니다.
- 브라우저, 메일, 문서 편집기 등에 HTML로 붙여넣는 용도는 동작할 가능성이 높습니다.
- Excel에 다시 붙여넣을 때는 환경에 따라 표 구조만 유지되거나, 서식/병합/폭/색상 일부가 깨질 수 있습니다.
- helper가 없거나 실행에 실패하면 플러그인은 자동으로 이 fallback 경로를 사용하고, 가능한 경우 `Notice`로 안내합니다.

### helper가 있을 때

- Windows Desktop 환경에서 helper 실행 파일을 찾으면, Excel 클립보드 HTML을 native CF_HTML 경로로 먼저 읽습니다.
- `HTML` 버튼을 누르면 저장된 HTML을 Windows `HTML Format`으로 클립보드에 직접 씁니다.
- 동시에 `CF_UNICODETEXT`, `CF_TEXT`, `CF_OEMTEXT` fallback도 함께 설정해 Excel 외 앱에서도 붙여넣기 가능성을 높입니다.
- Excel에 다시 붙여넣을 때 표 구조와 HTML 서식이 유지될 가능성이 helper 없는 경로보다 높습니다.
- helper는 Windows에서만 사용되며, macOS/Linux 또는 helper가 없는 Windows 환경에서는 표준 Clipboard API fallback으로 동작합니다.

### 사용자가 체감하는 차이

| 작업 | helper 없음 | helper 있음 |
| --- | --- | --- |
| Obsidian에 Excel 표 저장 | 동작 | 동작 |
| 이미지 미리보기 렌더링 | 동작 | 동작 |
| 검색용 `table.search.md` 생성 | 동작 | 동작 |
| asset 교체/삭제 | 동작 | 동작 |
| HTML을 브라우저/문서 앱에 복사 | 대체로 동작 | 대체로 동작 |
| HTML을 Excel에 다시 붙여넣기 | 환경 의존 | 더 안정적 |
| Excel 원본 수준 서식 왕복 | 보장 어려움 | 가장 권장되는 경로 |

정리하면, helper는 기본 저장 기능을 위한 필수 요소가 아니라 **Windows Excel 서식 왕복 품질을 높이는 선택 구성**입니다.

## 사용 흐름

Excel에서 표를 복사한 뒤 Obsidian 편집기에서 우클릭하고 `Excel 표(HTML) 붙여넣기`를 선택합니다.

플러그인은 vault 안에 다음과 같은 asset 폴더를 만들고, 현재 문서에는 코드블럭을 삽입합니다.

```text
assets/excel-paste/{id}/
  meta.json
  table.html
  table.png
  table.search.md
```

문서에는 다음 형태의 코드블럭이 들어갑니다.

````markdown
```excel-html-asset
path: assets/excel-paste/{id}/meta.json
```
````

읽기 모드에서는 이 코드블럭이 Excel 표 이미지로 렌더링됩니다. 이미지가 없는 경우 HTML-only fallback 메시지를 표시합니다.

## Asset 관리

렌더링된 Excel asset 위에서 우클릭하면 다음 작업을 할 수 있습니다.

- `이력 남기고 Excel 표(HTML) 교체`: 기존 `table.html`, `table.png`, `table.search.md`, `meta.json`을 timestamp가 붙은 파일명으로 보관한 뒤 새 클립보드 내용으로 교체합니다.
- `Excel 표(HTML) 완전 교체`: 기존 활성 파일을 새 클립보드 내용으로 덮어쓰고, 이전 이력 파일을 삭제합니다.
- `Excel asset 삭제`: 문서의 코드블럭과 연결된 asset 폴더를 함께 삭제합니다.

교체 중 오류가 나면 가능한 범위에서 이전 파일을 복원하도록 rollback 처리가 들어 있습니다.

## 프로젝트 구조

- `main.ts`: Obsidian 플러그인 진입점, 클립보드 처리, asset 생성/렌더링/교체/삭제 로직
- `styles.css`: 렌더링된 Excel 이미지, HTML 복사 버튼, 오류/fallback 표시 스타일
- `manifest.json`: Obsidian 플러그인 메타데이터
- `esbuild.config.mjs`: `main.ts`를 `main.js`로 번들링하는 설정
- `helper/`: Windows CF_HTML 읽기/쓰기를 위한 Rust native helper
- `bin/`: 배포 시 native helper 실행 파일을 두는 위치

## 빌드

의존성을 설치합니다.

```bash
npm install
```

플러그인 JavaScript를 빌드합니다.

```bash
npm run build
```

Windows native helper를 빌드할 때는 Rust toolchain이 필요합니다.

```bash
npm run build:helper:win64
```

빌드된 helper 실행 파일은 배포 전에 다음 위치에 맞춰 둡니다.

```text
bin/excel-html-clipboard-win32-x64.exe
```

arm64 Windows용 helper는 다음 이름을 사용합니다.

```text
bin/excel-html-clipboard-win32-arm64.exe
```

## 설치 방법

GitHub Actions 또는 Release artifact에서 `excel-html-paste-plugin`을 내려받습니다. 압축을 풀면 다음 구조의 폴더가 들어 있습니다.

```text
excel-html-paste/
  manifest.json
  main.js
  styles.css
  bin/
    excel-html-clipboard-win32-x64.exe
```

압축을 푼 `excel-html-paste/` 폴더를 vault의 아래 위치에 둡니다.

```text
.obsidian/plugins/excel-html-paste/
  manifest.json
  main.js
  styles.css
  bin/
    excel-html-clipboard-win32-x64.exe
```

파일을 배치한 뒤 Obsidian에서 커뮤니티 플러그인 목록을 새로고침하고 `Excel HTML Paste`를 활성화합니다.

Release에는 Obsidian 커뮤니티 플러그인 등록 호환을 위해 `manifest.json`, `main.js`, `styles.css` 개별 파일도 함께 올라갈 수 있습니다. 수동 설치할 때는 plugin artifact를 받는 쪽이 편합니다.

Windows native clipboard helper는 선택 구성입니다. 기본 설치와 기본 붙여넣기 동작에는 helper 실행 파일이 필요하지 않습니다. Windows에서 Excel의 CF_HTML 클립보드를 더 안정적으로 읽고 쓰고 싶을 때 helper 실행 파일을 배치합니다.

```text
excel-html-paste/
  bin/
    excel-html-clipboard-win32-x64.exe
```

vault 안에서는 다음 위치가 됩니다.

```text
.obsidian/plugins/excel-html-paste/
  manifest.json
  main.js
  styles.css
  bin/
    excel-html-clipboard-win32-x64.exe
```

현재 저장소의 `bin/`에는 자리표시자인 `.gitkeep`만 있습니다. 기본 설치에는 문제가 없으며, 실제 helper 실행 파일은 필요한 경우에만 별도로 빌드해서 배치합니다.

GitHub Actions로 배포되는 `excel-html-paste-plugin` artifact에는 Windows x64 helper가 포함됩니다. 저장소를 직접 clone해서 빌드하는 경우에는 `npm run build:helper:win64`로 helper를 만든 뒤 `bin/excel-html-clipboard-win32-x64.exe` 위치에 복사해야 합니다.

## 동작 메모

- 플러그인은 Desktop 전용입니다.
- 클립보드에 `text/html`이 없으면 붙여넣기를 중단합니다.
- 클립보드에 이미지가 없으면 HTML 원본과 검색용 Markdown만 저장합니다.
- 생성되는 asset 경로는 `assets/excel-paste/` 아래로 제한됩니다.
- `table.search.md`는 Obsidian 검색에 걸리도록 HTML table 내용을 Markdown table 형태로 변환한 보조 파일입니다.

---

# Excel HTML Paste

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
