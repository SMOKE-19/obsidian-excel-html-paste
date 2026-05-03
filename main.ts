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

    if (!htmlBlob) {
      throw new Error("클립보드에 text/html 데이터가 없습니다.");
    }

    let html: string;
    try {
      html = await htmlBlob.text();
    } catch (error) {
      throw new Error(`HTML Blob을 텍스트로 변환하지 못했습니다: ${this.errorMessage(error)}`);
    }

    if (!html.trim()) {
      throw new Error("클립보드 HTML 데이터가 비어 있습니다.");
    }

    const imageBuffer = imageBlob ? await imageBlob.arrayBuffer() : null;

    return {
      html,
      imageBuffer
    };
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
    if (!navigator.clipboard) {
      throw new Error("Clipboard API를 사용할 수 없습니다.");
    }

    const normalizedHtml = this.normalizeHtmlForClipboard(html);
    const plainText = this.htmlToPlainText(normalizedHtml);

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

  private normalizeHtmlForClipboard(html: string): string {
    const fragment = this.extractCfHtmlFragment(html);
    const body = fragment ?? html;

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

  private extractCfHtmlFragment(html: string): string | null {
    if (!/^Version:/i.test(html.trimStart())) {
      return null;
    }

    const fragmentMatch = html.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
    if (fragmentMatch) {
      return fragmentMatch[1];
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
