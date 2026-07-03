# Excel HTML Paste

[English](README.md)

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
