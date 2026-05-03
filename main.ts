import { spawn } from "child_process";
import { join } from "path";
import {
  Editor,
  FileSystemAdapter,
  MarkdownPostProcessorContext,
  Menu,
  Notice,
  Plugin,
  TFile
} from "obsidian";

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
  search?: string;
  createdAt: string;
}

interface CreatedAsset {
  basePath: string;
  metaPath: string;
  htmlPath: string;
  imagePath: string | null;
  searchPath: string;
}

interface RenderedAsset {
  basePath: string;
  metaPath: string;
  htmlPath: string;
  imagePath: string | null;
  meta: ExcelAssetMeta;
}

interface ArchivedAssetFile {
  originalPath: string;
  archivedPath: string;
}

export default class ExcelHtmlPastePlugin extends Plugin {
  async onload() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        menu.addItem((item) => {
          item
            .setTitle("Excel 표(HTML) 붙여넣기")
            .setIcon("table")
            .onClick(async () => {
              const sourcePath = info.file?.path ?? this.app.workspace.getActiveFile()?.path ?? null;
              await this.handleExcelPaste(editor, sourcePath);
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

  private async handleExcelPaste(editor: Editor, sourcePath: string | null): Promise<void> {
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
      const asset = await this.createExcelAsset(payload, sourcePath);
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

    const nativeHtml = await this.tryReadHtmlWithNativeClipboard();

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

  private async tryReadHtmlWithNativeClipboard(): Promise<string | null> {
    if (!this.isWindowsDesktop()) {
      return null;
    }

    const helperPath = this.getNativeHelperPath();
    if (!helperPath) {
      console.warn("Native clipboard helper path is unavailable.");
      new Notice("Windows native helper를 찾지 못해 브라우저 클립보드로 저장합니다.");
      return null;
    }

    try {
      return await this.runNativeHelper(["read-html"], "");
    } catch (error) {
      console.warn(`Native clipboard read failed via ${helperPath}; falling back to browser clipboard.`, error);
      new Notice("Windows native HTML 읽기에 실패해 브라우저 클립보드로 저장합니다.");
      return null;
    }
  }

  private async createExcelAsset(
    payload: ClipboardExcelPayload,
    sourcePath: string | null
  ): Promise<CreatedAsset> {
    const id = this.generateId();
    const basePath = `${ASSET_ROOT}/${id}`;
    const htmlPath = `${basePath}/table.html`;
    const imagePath = payload.imageBuffer ? `${basePath}/table.png` : null;
    const searchPath = `${basePath}/table.search.md`;
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

      await this.app.vault.create(searchPath, this.htmlToSearchMarkdown(payload.html, sourcePath));
      createdPaths.push(searchPath);

      const meta: ExcelAssetMeta = {
        type: ASSET_TYPE,
        version: 1,
        image: imagePath ? "table.png" : null,
        html: "table.html",
        search: "table.search.md",
        createdAt: new Date().toISOString()
      };

      await this.app.vault.create(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
      createdPaths.push(metaPath);

      return {
        basePath,
        metaPath,
        htmlPath,
        imagePath,
        searchPath
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

  private buildCodeBlock(metaPath: string, updatedAt?: string): string {
    return `\n${this.buildCodeBlockSection(metaPath, updatedAt)}\n`;
  }

  private buildCodeBlockSection(metaPath: string, updatedAt?: string): string {
    const lines = [`\`\`\`${CODE_BLOCK}`, `path: ${metaPath}`];
    if (updatedAt) {
      lines.push(`updatedAt: ${updatedAt}`);
    }
    lines.push("```");
    return lines.join("\n");
  }

  private async renderExcelAsset(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
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

    const asset: RenderedAsset = {
      basePath,
      metaPath,
      htmlPath,
      imagePath: meta.image ? `${basePath}/${meta.image}` : null,
      meta
    };
    const wrapper = el.createDiv({ cls: "excel-html-wrapper" });
    this.registerAssetContextMenu(wrapper, el, ctx, asset);

    if (meta.image) {
      const imagePath = `${basePath}/${meta.image}`;
      const imageFile = this.getFile(imagePath);

      if (imageFile) {
        const image = wrapper.createEl("img", {
          cls: "excel-html-image",
          attr: {
            src: this.buildResourcePath(imageFile, meta.createdAt),
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

  private registerAssetContextMenu(
    wrapper: HTMLElement,
    processorEl: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    asset: RenderedAsset
  ): void {
    this.registerDomEvent(wrapper, "contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle("Excel 표(HTML)로 교체")
          .setIcon("replace")
          .onClick(async () => {
            await this.replaceRenderedAsset(processorEl, ctx, asset);
          });
      });
      menu.addItem((item) => {
        item
          .setTitle("Excel asset 삭제")
          .setIcon("trash")
          .onClick(async () => {
            await this.deleteRenderedAsset(processorEl, ctx, asset);
          });
      });
      menu.showAtMouseEvent(event);
    });
  }

  private async replaceRenderedAsset(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    currentAsset: RenderedAsset
  ): Promise<void> {
    try {
      const payload = await this.readExcelClipboard();
      const updatedAt = await this.replaceAssetFilesInPlace(currentAsset, payload, ctx.sourcePath);
      await this.replaceRenderedCodeBlock(el, ctx, this.buildCodeBlockSection(currentAsset.metaPath, updatedAt));
      new Notice("Excel asset을 새 클립보드 내용으로 교체하고 이전 파일을 이력으로 보관했습니다.");
    } catch (error) {
      this.reportError("Excel asset 교체에 실패했습니다.", error);
    }
  }

  private async replaceAssetFilesInPlace(
    asset: RenderedAsset,
    payload: ClipboardExcelPayload,
    sourcePath: string | null
  ): Promise<string> {
    if (!this.isManagedAssetPath(asset.basePath)) {
      throw new Error(`관리 대상 asset 경로가 아닙니다: ${asset.basePath}`);
    }

    const archivedFiles = await this.archiveActiveAssetFiles(asset);

    try {
      await this.app.vault.adapter.write(asset.htmlPath, payload.html);
      await this.app.vault.adapter.write(
        `${asset.basePath}/table.search.md`,
        this.htmlToSearchMarkdown(payload.html, sourcePath)
      );

      const activeImagePath = `${asset.basePath}/table.png`;
      if (payload.imageBuffer) {
        await this.app.vault.adapter.writeBinary(activeImagePath, payload.imageBuffer);
      } else if (await this.app.vault.adapter.exists(activeImagePath)) {
        await this.app.vault.adapter.remove(activeImagePath);
      }

      const updatedAt = new Date().toISOString();
      const meta: ExcelAssetMeta = {
        type: ASSET_TYPE,
        version: 1,
        image: payload.imageBuffer ? "table.png" : null,
        html: "table.html",
        search: "table.search.md",
        createdAt: updatedAt
      };
      await this.app.vault.adapter.write(asset.metaPath, `${JSON.stringify(meta, null, 2)}\n`);
      return updatedAt;
    } catch (error) {
      await this.rollbackInPlaceReplacement(asset, archivedFiles);
      throw error;
    }
  }

  private async archiveActiveAssetFiles(asset: RenderedAsset): Promise<ArchivedAssetFile[]> {
    const archivedFiles: ArchivedAssetFile[] = [];
    const candidates = [
      asset.htmlPath,
      `${asset.basePath}/table.png`,
      `${asset.basePath}/table.search.md`,
      asset.metaPath
    ];

    for (const originalPath of Array.from(new Set(candidates))) {
      if (!(await this.app.vault.adapter.exists(originalPath))) {
        continue;
      }

      const archivedPath = await this.nextHistoryPath(originalPath);
      await this.app.vault.adapter.rename(originalPath, archivedPath);
      archivedFiles.push({ originalPath, archivedPath });
    }

    return archivedFiles;
  }

  private async rollbackInPlaceReplacement(
    asset: RenderedAsset,
    archivedFiles: ArchivedAssetFile[]
  ): Promise<void> {
    for (const path of [asset.htmlPath, `${asset.basePath}/table.png`, `${asset.basePath}/table.search.md`, asset.metaPath]) {
      if (await this.app.vault.adapter.exists(path)) {
        try {
          await this.app.vault.adapter.remove(path);
        } catch (error) {
          console.error(`Failed to remove partial replacement file: ${path}`, error);
        }
      }
    }

    for (const file of [...archivedFiles].reverse()) {
      if (!(await this.app.vault.adapter.exists(file.archivedPath))) {
        continue;
      }

      try {
        await this.app.vault.adapter.rename(file.archivedPath, file.originalPath);
      } catch (error) {
        console.error(`Failed to restore archived asset file: ${file.archivedPath}`, error);
      }
    }
  }

  private async deleteRenderedAsset(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    asset: RenderedAsset
  ): Promise<void> {
    if (!window.confirm("이 Excel asset 블록과 연결된 asset 폴더를 삭제할까요?")) {
      return;
    }

    try {
      await this.replaceRenderedCodeBlock(el, ctx, "");
    } catch (error) {
      this.reportError("문서에서 Excel asset 블록을 제거하지 못했습니다.", error);
      return;
    }

    try {
      await this.deleteAssetFolder(asset.basePath);
      new Notice("Excel asset을 삭제했습니다.");
    } catch (error) {
      this.reportError("asset 폴더 삭제에 실패했습니다. 문서 블록은 제거되었습니다.", error);
    }
  }

  private async replaceRenderedCodeBlock(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    replacement: string
  ): Promise<void> {
    const sourceFile = this.getFile(ctx.sourcePath);
    if (!sourceFile) {
      throw new Error(`현재 문서를 찾을 수 없습니다: ${ctx.sourcePath}`);
    }

    const section = ctx.getSectionInfo(el);
    if (!section) {
      throw new Error("렌더된 asset의 문서 위치를 찾지 못했습니다. 읽기 화면을 새로고침한 뒤 다시 시도하세요.");
    }

    const content = await this.app.vault.read(sourceFile);
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    const replacementLines = replacement ? replacement.split("\n") : [];

    lines.splice(section.lineStart, section.lineEnd - section.lineStart + 1, ...replacementLines);
    await this.app.vault.modify(sourceFile, lines.join(newline));
  }

  private async deleteAssetFolder(basePath: string): Promise<void> {
    if (!this.isManagedAssetPath(basePath)) {
      throw new Error(`관리 대상 asset 경로가 아닙니다: ${basePath}`);
    }

    if (!(await this.app.vault.adapter.exists(basePath))) {
      return;
    }

    await this.app.vault.adapter.rmdir(basePath, true);
  }

  private isManagedAssetPath(path: string): boolean {
    return path.startsWith(`${ASSET_ROOT}/`) && !path.includes("..") && path.split("/").length >= 3;
  }

  private buildResourcePath(file: TFile, version: string): string {
    const resourcePath = this.app.vault.getResourcePath(file);
    const separator = resourcePath.includes("?") ? "&" : "?";
    return `${resourcePath}${separator}v=${encodeURIComponent(version)}`;
  }

  private async nextHistoryPath(path: string): Promise<string> {
    const suffix = this.generateHistorySuffix();
    const extensionIndex = path.lastIndexOf(".");
    const stem = extensionIndex >= 0 ? path.slice(0, extensionIndex) : path;
    const extension = extensionIndex >= 0 ? path.slice(extensionIndex) : "";

    for (let index = 0; index < 100; index += 1) {
      const extra = index === 0 ? "" : `-${index}`;
      const candidate = `${stem}-${suffix}${extra}${extension}`;
      if (!(await this.app.vault.adapter.exists(candidate))) {
        return candidate;
      }
    }

    throw new Error(`이력 파일명을 만들 수 없습니다: ${path}`);
  }

  private generateHistorySuffix(): string {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("");
    const time = [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");

    return `${date}-${time}`;
  }

  private async writeHtmlToClipboard(html: string): Promise<void> {
    const normalizedHtml = this.normalizeHtmlForClipboard(html);
    const plainText = this.htmlToPlainText(normalizedHtml);

    if (this.isWindowsDesktop()) {
      try {
        await this.writeHtmlWithNativeClipboard(normalizedHtml, plainText);
        return;
      } catch (error) {
        console.warn("Native clipboard helper failed; falling back to browser clipboard.", error);
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

  private async writeHtmlWithNativeClipboard(html: string, text: string): Promise<void> {
    const payload = JSON.stringify({ html, text });
    await this.runNativeHelper(["write-html"], payload);
  }

  private getNativeHelperPath(): string | null {
    if (!this.isWindowsDesktop() || !(this.app.vault.adapter instanceof FileSystemAdapter)) {
      return null;
    }

    const helperName = process.arch === "arm64"
      ? "excel-html-clipboard-win32-arm64.exe"
      : "excel-html-clipboard-win32-x64.exe";

    const pluginDir = this.manifest.dir ?? join(this.app.vault.configDir, "plugins", this.manifest.id);
    return join(this.app.vault.adapter.getBasePath(), pluginDir, "bin", helperName);
  }

  private runNativeHelper(args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const helperPath = this.getNativeHelperPath();
      if (!helperPath) {
        reject(new Error("Windows native clipboard helper를 찾을 수 없습니다."));
        return;
      }

      const child = spawn(helperPath, args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const stdout: string[] = [];
      const stderr: string[] = [];
      const timer = window.setTimeout(() => {
        child.kill();
        reject(new Error("Native clipboard helper timed out."));
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

        reject(new Error(stderr.join("").trim() || stdout.join("").trim() || `Native clipboard helper exited with code ${code}.`));
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

  private htmlToSearchMarkdown(html: string, sourcePath: string | null): string {
    const doc = new DOMParser().parseFromString(this.normalizeHtmlForClipboard(html), "text/html");
    const lines = [
      "# Excel HTML Paste Search Index",
      "",
      `Updated: ${new Date().toISOString()}`
    ];

    if (sourcePath) {
      lines.push(`Source: ${this.sourcePathToWikilink(sourcePath)}`);
    }

    const tables = Array.from(doc.querySelectorAll("table"));
    if (tables.length === 0) {
      const text = this.normalizeCellText(doc.body.textContent ?? "");
      lines.push("", "## Text", "", text || "(empty)");
      return `${lines.join("\n")}\n`;
    }

    for (const [tableIndex, table] of tables.entries()) {
      const rows = Array.from(table.querySelectorAll("tr"))
        .map((row) =>
          Array.from(row.querySelectorAll("th,td"))
            .map((cell) => this.escapeMarkdownTableCell(this.normalizeCellText(cell.textContent ?? "")))
        )
        .filter((row) => row.some((cell) => cell.length > 0));

      if (rows.length === 0) {
        continue;
      }

      const columnCount = Math.max(...rows.map((row) => row.length));
      const paddedRows = rows.map((row) => [...row, ...Array(Math.max(0, columnCount - row.length)).fill("")]);
      const heading = tables.length === 1 ? "## Table" : `## Table ${tableIndex + 1}`;
      const header = paddedRows[0];
      const body = paddedRows.slice(1);

      lines.push("", heading, "");
      lines.push(`| ${header.join(" | ")} |`);
      lines.push(`| ${Array(columnCount).fill("---").join(" | ")} |`);
      for (const row of body) {
        lines.push(`| ${row.join(" | ")} |`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  private sourcePathToWikilink(sourcePath: string): string {
    const linkPath = sourcePath.replace(/\.md$/i, "");
    const label = linkPath.split("/").pop() ?? linkPath;
    return `[[${linkPath}|${label}]]`;
  }

  private escapeMarkdownTableCell(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
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

    if (meta.search !== undefined && typeof meta.search !== "string") {
      throw new Error("meta.search 값이 올바르지 않습니다.");
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
