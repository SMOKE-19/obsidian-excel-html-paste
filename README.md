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

이 플러그인의 기본 실행 파일은 다음 3개입니다.

```text
excel-html-paste/
  manifest.json
  main.js
  styles.css
```

이 3개 파일을 vault의 아래 위치에 두면 Obsidian 플러그인으로 인식됩니다.

```text
.obsidian/plugins/excel-html-paste/
  manifest.json
  main.js
  styles.css
```

파일을 배치한 뒤 Obsidian에서 커뮤니티 플러그인 목록을 새로고침하고 `Excel HTML Paste`를 활성화합니다.

Windows native clipboard helper는 선택 구성입니다. Windows에서 Excel의 CF_HTML 클립보드를 더 안정적으로 읽고 쓰고 싶을 때만 helper 실행 파일을 추가로 배치합니다.

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

## Obsidian 커뮤니티 플러그인 등록

Obsidian 커뮤니티 플러그인 목록에 올리려면 GitHub 공개 저장소와 GitHub Release가 필요합니다. Obsidian은 커뮤니티 플러그인 목록에서 `manifest.json`과 `README.md`를 읽고, 설치할 때는 `manifest.json`의 버전과 같은 태그의 GitHub Release에서 `manifest.json`, `main.js`, `styles.css`를 내려받습니다.

등록 준비 체크리스트는 다음과 같습니다.

- 저장소가 공개되어 있어야 합니다.
- `README.md`, `LICENSE`, `manifest.json`, `versions.json`이 저장소에 있어야 합니다.
- `manifest.json`의 `id`, `name`, `version`, `minAppVersion`, `description`, `author` 값이 정확해야 합니다.
- `npm run build`로 생성한 `main.js`가 준비되어야 합니다.
- `manifest.json`의 `version`과 같은 Git 태그 및 GitHub Release를 만들어야 합니다.
- Release asset에는 `manifest.json`, `main.js`, `styles.css`를 포함해야 합니다.
- 이후 `obsidianmd/obsidian-releases` 저장소의 `community-plugins.json`에 플러그인 항목을 추가하는 PR을 보냅니다.

공식 커뮤니티 플러그인 등록은 Obsidian 팀의 리뷰를 거칩니다. 이 저장소는 MIT License를 사용하므로 사용, 수정, 재배포, 상업적 사용 측면에서 비교적 부담이 적은 오픈소스 형태입니다.

## 동작 메모

- 플러그인은 Desktop 전용입니다.
- 클립보드에 `text/html`이 없으면 붙여넣기를 중단합니다.
- 클립보드에 이미지가 없으면 HTML 원본과 검색용 Markdown만 저장합니다.
- 생성되는 asset 경로는 `assets/excel-paste/` 아래로 제한됩니다.
- `table.search.md`는 Obsidian 검색에 걸리도록 HTML table 내용을 Markdown table 형태로 변환한 보조 파일입니다.

## 라이선스

이 프로젝트는 [MIT License](LICENSE)를 사용합니다.
