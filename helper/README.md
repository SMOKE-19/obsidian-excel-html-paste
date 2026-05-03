# Rust Native Clipboard Helper

이 helper는 Windows Clipboard의 `HTML Format` / CF_HTML을 직접 읽고 쓰는 one-shot CLI다.

## 명령

```powershell
excel-html-clipboard-win32-x64.exe read-html
```

- stdout으로 Windows Clipboard의 `HTML Format` 데이터를 출력한다.

```powershell
excel-html-clipboard-win32-x64.exe write-html
```

- stdin으로 `{ "html": "...", "text": "..." }` JSON payload를 받는다.
- Windows Clipboard에 `HTML Format`, `CF_UNICODETEXT`, `CF_TEXT`, `CF_OEMTEXT`를 세팅한다.

## 배포 위치

Obsidian 플러그인 폴더에는 다음 구조로 둔다.

```txt
excel-html-paste/
  manifest.json
  main.js
  styles.css
  bin/
    excel-html-clipboard-win32-x64.exe
```

arm64 Windows용 빌드를 제공할 때는 `bin/excel-html-clipboard-win32-arm64.exe` 이름을 사용한다.

## Windows x64 빌드

Windows 개발 환경에서:

```powershell
npm run build:helper:win64
copy helper\target\x86_64-pc-windows-msvc\release\excel-html-clipboard.exe bin\excel-html-clipboard-win32-x64.exe
```

그 다음 플러그인 루트에서:

```powershell
npm run build
```
