import { spawn } from "child_process";
import { Editor, MarkdownPostProcessorContext, Notice, Plugin, TFile } from "obsidian";

const ASSET_ROOT = "assets/excel-paste";
const CODE_BLOCK = "excel-html-asset";
const ASSET_TYPE = "excel-html-paste";

interface ClipboardExcelPayload {
  html: string;
  imageBuffer: ArrayBuffer | null;
}

interface ExcelAssetMeta {
  type: typeof ASSET_TYPE;
  version: 1;
  image: string | null;
  html: string;
  createdAt: string;
}

interface CreatedAsset {
  basePath: string;
  metaPath: string;
  htmlPath: string;
  imagePath: string | null;
}

export default class ExcelHtmlPastePlugin extends Plugin {
  async onload() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) => {
          item
            .setTitle("Excel 표(HTML) 붙여넣기")
            .setIcon("table")
            .onClick(async () => {
              await this.handleExcelPaste(editor);
            });
        });
      })
    );

    this.registerMarkdownCodeBlockProcessor(
      CODE_BLOCK,
      async (source, el, ctx) => {
        await this.renderExcelAsset(source, el, ctx);
      }
    );
  }

  private async handleExcelPaste(editor: Editor): Promise<void> {
    let payload: ClipboardExcelPayload;

    try {
      payload = await this.readExcelClipboard();
    } catch (error) {
      this.reportError("클립보드에서 Excel HTML 데이터를 읽지 못했습니다.", error);
      return;
    }

    if (!payload.imageBuffer) {
      new Notice("이미지 데이터가 없어 HTML만 asset으로 저장합니다.");
    }

    try {
      const asset = await this.createExcelAsset(payload);
      editor.replaceSelection(this.buildCodeBlock(asset.metaPath));
      new Notice("Excel HTML asset을 삽입했습니다.");
    } catch (error) {
      this.reportError("Excel HTML asset 저장에 실패했습니다.", error);
    }
  }

  private async readExcelClipboard(): Promise<ClipboardExcelPayload> {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
      throw new Error("Clipboard read API를 사용할 수 없습니다.");
    }

    let items: ClipboardItems;
    try {
      items = await navigator.clipboard.read();
    } catch (error) {
      throw new Error(`Clipboard 접근 권한이 없거나 읽기에 실패했습니다: ${this.errorMessage(error)}`);
    }

    let htmlBlob: Blob | null = null;
    let imageBlob: Blob | null = null;

    for (const item of items) {
      if (!htmlBlob && item.types.includes("text/html")) {
        htmlBlob = await item.getType("text/html");
      }

      if (!imageBlob && item.types.includes("image/png")) {
        imageBlob = await item.getType("image/png");
      }
    }

    const nativeHtml = await this.tryReadHtmlWithPythonNativeClipboard();

    if (!htmlBlob && !nativeHtml) {
      throw new Error("클립보드에 text/html 데이터가 없습니다.");
    }

    let html: string | null = nativeHtml;
    if (!html && htmlBlob) {
      try {
        html = await htmlBlob.text();
      } catch (error) {
        throw new Error(`HTML Blob을 텍스트로 변환하지 못했습니다: ${this.errorMessage(error)}`);
      }
    }

    if (!html?.trim()) {
      throw new Error("클립보드 HTML 데이터가 비어 있습니다.");
    }

    const imageBuffer = imageBlob ? await imageBlob.arrayBuffer() : null;

    return {
      html,
      imageBuffer
    };
  }

  private async tryReadHtmlWithPythonNativeClipboard(): Promise<string | null> {
    if (!this.isWindowsDesktop()) {
      return null;
    }

    const errors: string[] = [];
    for (const command of this.pythonCommands(PYTHON_READ_CF_HTML_HELPER)) {
      try {
        return await this.runPythonHelper(command.executable, command.args, "");
      } catch (error) {
        errors.push(`${command.executable}: ${this.errorMessage(error)}`);
      }
    }

    console.warn("Python native clipboard read failed; falling back to browser clipboard.", errors.join(" | "));
    return null;
  }

  private async createExcelAsset(payload: ClipboardExcelPayload): Promise<CreatedAsset> {
    const id = this.generateId();
    const basePath = `${ASSET_ROOT}/${id}`;
    const htmlPath = `${basePath}/table.html`;
    const imagePath = payload.imageBuffer ? `${basePath}/table.png` : null;
    const metaPath = `${basePath}/meta.json`;
    const createdPaths: string[] = [];

    try {
      await this.app.vault.adapter.mkdir(basePath);

      if (payload.imageBuffer && imagePath) {
        await this.app.vault.createBinary(imagePath, payload.imageBuffer);
        createdPaths.push(imagePath);
      }

      await this.app.vault.create(htmlPath, payload.html);
      createdPaths.push(htmlPath);

      const meta: ExcelAssetMeta = {
        type: ASSET_TYPE,
        version: 1,
        image: imagePath ? "table.png" : null,
        html: "table.html",
        createdAt: new Date().toISOString()
      };

      await this.app.vault.create(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
      createdPaths.push(metaPath);

      return {
        basePath,
        metaPath,
        htmlPath,
        imagePath
      };
    } catch (error) {
      await this.rollbackCreatedFiles(createdPaths);
      throw error;
    }
  }

  private async rollbackCreatedFiles(paths: string[]): Promise<void> {
    let failed = false;

    for (const path of [...paths].reverse()) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        continue;
      }

      try {
        await this.app.vault.delete(file);
      } catch (error) {
        failed = true;
        console.error(`Failed to rollback ${path}`, error);
      }
    }

    if (failed) {
      new Notice("일부 생성 파일 rollback에 실패했습니다. 콘솔을 확인하세요.");
    }
  }

  private buildCodeBlock(metaPath: string): string {
    return `\n\`\`\`${CODE_BLOCK}\npath: ${metaPath}\n\`\`\`\n`;
  }

  private async renderExcelAsset(
    source: string,
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const metaPath = this.parseMetaPath(source);
    if (!metaPath) {
      this.renderError(el, "Excel HTML asset path가 없습니다.");
      return;
    }

    const metaFile = this.getFile(metaPath);
    if (!metaFile) {
      this.renderError(el, `meta.json을 찾을 수 없습니다: ${metaPath}`);
      return;
    }

    let meta: ExcelAssetMeta;
    try {
      meta = this.validateMeta(JSON.parse(await this.app.vault.read(metaFile)));
    } catch (error) {
      this.renderError(el, `meta.json을 읽을 수 없습니다: ${this.errorMessage(error)}`);
      return;
    }

    const basePath = metaPath.substring(0, metaPath.lastIndexOf("/"));
    const htmlPath = `${basePath}/${meta.html}`;
    const htmlFile = this.getFile(htmlPath);
    if (!htmlFile) {
      this.renderError(el, `HTML asset을 찾을 수 없습니다: ${htmlPath}`);
      return;
    }

    const wrapper = el.createDiv({ cls: "excel-html-wrapper" });

    if (meta.image) {
      const imagePath = `${basePath}/${meta.image}`;
      const imageFile = this.getFile(imagePath);

      if (imageFile) {
        const image = wrapper.createEl("img", {
          cls: "excel-html-image",
          attr: {
            src: this.app.vault.getResourcePath(imageFile),
            alt: "Excel HTML paste preview"
          }
        });
        image.draggable = false;
      } else {
        wrapper.createDiv({
          cls: "excel-html-fallback",
          text: `이미지 asset을 찾을 수 없습니다: ${imagePath}`
        });
      }
    } else {
      wrapper.createDiv({
        cls: "excel-html-fallback",
        text: "HTML-only Excel asset"
      });
    }

    const button = wrapper.createEl("button", {
      cls: "excel-html-copy-button",
      text: "HTML",
      attr: {
        type: "button",
        "aria-label": "Excel HTML 원본 복사"
      }
    });

    button.addEventListener("click", async () => {
      try {
        const html = await this.app.vault.read(htmlFile);
        await this.writeHtmlToClipboard(html);
        new Notice("HTML 원본을 서식 포함 클립보드에 복사했습니다.");
      } catch (error) {
        this.reportError("HTML 원본 복사에 실패했습니다.", error);
      }
    });
  }

  private async writeHtmlToClipboard(html: string): Promise<void> {
    const normalizedHtml = this.normalizeHtmlForClipboard(html);
    const plainText = this.htmlToPlainText(normalizedHtml);

    if (this.isWindowsDesktop()) {
      try {
        await this.writeHtmlWithPythonNativeClipboard(normalizedHtml, plainText);
        return;
      } catch (error) {
        console.warn("Python native clipboard helper failed; falling back to browser clipboard.", error);
        new Notice("Windows native HTML 복사에 실패해 브라우저 클립보드 방식으로 재시도합니다.");
      }
    }

    if (!navigator.clipboard) {
      throw new Error("Clipboard API를 사용할 수 없습니다.");
    }

    if (typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
      const item = new ClipboardItem({
        "text/html": new Blob([normalizedHtml], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" })
      });
      await navigator.clipboard.write([item]);
      return;
    }

    if (typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(plainText || normalizedHtml);
      new Notice("이 환경은 text/html 클립보드 쓰기를 지원하지 않아 일반 텍스트로 복사했습니다.");
      return;
    }

    throw new Error("Clipboard write API를 사용할 수 없습니다.");
  }

  private isWindowsDesktop(): boolean {
    return typeof process !== "undefined" && process.platform === "win32";
  }

  private async writeHtmlWithPythonNativeClipboard(html: string, text: string): Promise<void> {
    const payload = JSON.stringify({ html, text });
    const errors: string[] = [];

    for (const command of this.pythonCommands(PYTHON_WRITE_CF_HTML_HELPER)) {
      try {
        await this.runPythonHelper(command.executable, command.args, payload);
        return;
      } catch (error) {
        errors.push(`${command.executable}: ${this.errorMessage(error)}`);
      }
    }

    throw new Error(errors.join(" | "));
  }

  private pythonCommands(script: string): Array<{ executable: string; args: string[] }> {
    return [
      { executable: "python", args: ["-c", script] },
      { executable: "py", args: ["-3", "-c", script] },
      { executable: "python3", args: ["-c", script] }
    ];
  }

  private runPythonHelper(executable: string, args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout: string[] = [];
      const stderr: string[] = [];
      const timer = window.setTimeout(() => {
        child.kill();
        reject(new Error("Python helper timed out."));
      }, 10000);

      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
      child.on("error", (error) => {
        window.clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        window.clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.join(""));
          return;
        }

        reject(new Error(stderr.join("").trim() || stdout.join("").trim() || `Python helper exited with code ${code}.`));
      });

      child.stdin.write(input);
      child.stdin.end();
    });
  }

  private normalizeHtmlForClipboard(html: string): string {
    const cfHtml = this.extractCfHtmlDocument(html);
    if (cfHtml) {
      return cfHtml;
    }

    const body = html;

    if (/<html[\s>]/i.test(body)) {
      return body;
    }

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
</head>
<body>
${body}
</body>
</html>`;
  }

  private extractCfHtmlDocument(html: string): string | null {
    if (!/^Version:/i.test(html.trimStart())) {
      return null;
    }

    const startMatch = html.match(/StartHTML:(\d+)/i);
    const endMatch = html.match(/EndHTML:(\d+)/i);
    if (!startMatch || !endMatch) {
      return null;
    }

    const start = Number(startMatch[1]);
    const end = Number(endMatch[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      return null;
    }

    return html.slice(start, end);
  }

  private htmlToPlainText(html: string): string {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table");
    if (table) {
      const rows = Array.from(table.querySelectorAll("tr"));
      return rows
        .map((row) =>
          Array.from(row.querySelectorAll("th,td"))
            .map((cell) => this.normalizeCellText(cell.textContent ?? ""))
            .join("\t")
        )
        .join("\n");
    }

    return this.normalizeCellText(doc.body.textContent ?? "");
  }

  private normalizeCellText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private parseMetaPath(source: string): string | null {
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*path:\s*(.+?)\s*$/);
      if (match) {
        return match[1].trim();
      }
    }

    return null;
  }

  private validateMeta(value: unknown): ExcelAssetMeta {
    if (!value || typeof value !== "object") {
      throw new Error("meta.json이 객체가 아닙니다.");
    }

    const meta = value as Partial<ExcelAssetMeta>;
    if (meta.type !== ASSET_TYPE) {
      throw new Error("지원하지 않는 asset type입니다.");
    }

    if (meta.version !== 1) {
      throw new Error("지원하지 않는 asset version입니다.");
    }

    if (meta.image !== null && typeof meta.image !== "string") {
      throw new Error("meta.image 값이 올바르지 않습니다.");
    }

    if (typeof meta.html !== "string" || !meta.html) {
      throw new Error("meta.html 값이 올바르지 않습니다.");
    }

    if (typeof meta.createdAt !== "string" || !meta.createdAt) {
      throw new Error("meta.createdAt 값이 올바르지 않습니다.");
    }

    return meta as ExcelAssetMeta;
  }

  private getFile(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private renderError(el: HTMLElement, message: string): void {
    el.createDiv({
      cls: "excel-html-error",
      text: message
    });
  }

  private generateId(): string {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
    const time = [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");
    const suffix = Math.random().toString(36).slice(2, 8);

    return `${date}-${time}-${suffix}`;
  }

  private reportError(message: string, error: unknown): void {
    console.error(message, error);
    new Notice(`${message} ${this.errorMessage(error)}`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

const PYTHON_READ_CF_HTML_HELPER = String.raw`
import sys

try:
    import win32clipboard as wc
except Exception as exc:
    raise SystemExit(f"pywin32 is required: {exc}")


def decode_html_data(data) -> str:
    if isinstance(data, str):
        return data

    if isinstance(data, bytes):
        for encoding in ("utf-8", "cp949", "mbcs"):
            try:
                return data.decode(encoding)
            except Exception:
                continue
        return data.decode("utf-8", errors="replace")

    return str(data)


def main() -> None:
    html_format = wc.RegisterClipboardFormat("HTML Format")
    wc.OpenClipboard()
    try:
        if not wc.IsClipboardFormatAvailable(html_format):
            raise SystemExit("HTML Format is not available.")
        data = wc.GetClipboardData(html_format)
    finally:
        wc.CloseClipboard()

    sys.stdout.write(decode_html_data(data))


if __name__ == "__main__":
    main()
`;

const PYTHON_WRITE_CF_HTML_HELPER = String.raw`
import json
import re
import sys

try:
    import win32clipboard as wc
except Exception as exc:
    raise SystemExit(f"pywin32 is required: {exc}")


START_MARKER = "<!--StartFragment-->"
END_MARKER = "<!--EndFragment-->"


def ensure_html_document(html: str) -> str:
    if START_MARKER in html and END_MARKER in html:
        return html

    if re.search(r"<html[\s>]", html, re.I):
        body_open = re.search(r"<body[^>]*>", html, re.I)
        body_close = re.search(r"</body\s*>", html, re.I)
        if body_open and body_close and body_open.end() <= body_close.start():
            return (
                html[: body_open.end()]
                + START_MARKER
                + html[body_open.end() : body_close.start()]
                + END_MARKER
                + html[body_close.start() :]
            )
        return START_MARKER + html + END_MARKER

    return (
        "<!DOCTYPE html>\r\n"
        "<html>\r\n"
        "<head><meta charset=\"utf-8\"></head>\r\n"
        "<body>\r\n"
        + START_MARKER
        + html
        + END_MARKER
        + "\r\n</body>\r\n</html>"
    )


def build_cf_html(html: str) -> bytes:
    html_doc = ensure_html_document(html)
    start_marker_index = html_doc.index(START_MARKER) + len(START_MARKER)
    end_marker_index = html_doc.index(END_MARKER)

    header_template = (
        "Version:0.9\r\n"
        "StartHTML:{start_html:010d}\r\n"
        "EndHTML:{end_html:010d}\r\n"
        "StartFragment:{start_fragment:010d}\r\n"
        "EndFragment:{end_fragment:010d}\r\n"
    )
    placeholder = header_template.format(
        start_html=0,
        end_html=0,
        start_fragment=0,
        end_fragment=0,
    )
    start_html = len(placeholder.encode("utf-8"))
    before_fragment = html_doc[:start_marker_index].encode("utf-8")
    fragment = html_doc[start_marker_index:end_marker_index].encode("utf-8")
    html_bytes = html_doc.encode("utf-8")
    start_fragment = start_html + len(before_fragment)
    end_fragment = start_fragment + len(fragment)
    end_html = start_html + len(html_bytes)
    header = header_template.format(
        start_html=start_html,
        end_html=end_html,
        start_fragment=start_fragment,
        end_fragment=end_fragment,
    )
    return header.encode("utf-8") + html_bytes


def encode_ansi(text: str) -> bytes:
    for encoding in ("cp949", "mbcs", "utf-8"):
        try:
            return text.encode(encoding, errors="replace")
        except Exception:
            continue
    return text.encode(errors="replace")


def main() -> None:
    payload = json.loads(sys.stdin.read())
    html = payload["html"]
    text = payload.get("text") or ""
    raw_html = build_cf_html(html)
    html_format = wc.RegisterClipboardFormat("HTML Format")

    wc.OpenClipboard()
    try:
        wc.EmptyClipboard()
        wc.SetClipboardData(wc.CF_UNICODETEXT, text)
        ansi_text = encode_ansi(text)
        wc.SetClipboardData(wc.CF_TEXT, ansi_text)
        try:
            wc.SetClipboardData(wc.CF_OEMTEXT, ansi_text)
        except Exception:
            pass
        wc.SetClipboardData(html_format, raw_html)
    finally:
        wc.CloseClipboard()


if __name__ == "__main__":
    main()
`;
