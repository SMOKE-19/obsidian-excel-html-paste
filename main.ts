import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import {
  Editor,
  FileSystemAdapter,
  MarkdownPostProcessorContext,
  Menu,
  Notice,
  Plugin,
  TFile,
  getLanguage
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

type ReplacementMode = "archive" | "overwrite";
type Locale = "en" | "ko";

const STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    pasteMenu: "Paste Excel table (HTML)",
    readClipboardFailed: "Could not read Excel HTML data from the clipboard.",
    noImageData: "No image data found. Saving HTML-only asset.",
    assetInserted: "Inserted Excel HTML asset.",
    assetSaveFailed: "Failed to save Excel HTML asset.",
    clipboardReadApiUnavailable: "Clipboard read API is unavailable.",
    clipboardReadFailed: "Clipboard permission was denied or reading failed",
    noClipboardHtml: "Clipboard does not contain text/html data.",
    htmlBlobReadFailed: "Failed to convert HTML Blob to text",
    emptyClipboardHtml: "Clipboard HTML data is empty.",
    nativeReadFailed: "Windows native HTML read failed. Saving through browser clipboard fallback.",
    rollbackPartialFailed: "Failed to rollback some generated files. Check the console.",
    missingAssetPath: "Excel HTML asset path is missing.",
    missingMeta: "Could not find meta.json",
    readMetaFailed: "Could not read meta.json",
    missingHtmlAsset: "Could not find HTML asset",
    missingImageAsset: "Could not find image asset",
    htmlOnlyAsset: "HTML-only Excel asset",
    copyHtmlAria: "Copy original Excel HTML",
    copyHtmlSuccess: "Copied original HTML to the clipboard with formatting.",
    copyHtmlFailed: "Failed to copy original HTML.",
    replaceWithHistory: "Replace Excel table (HTML), keep history",
    replaceCompletely: "Replace Excel table (HTML) completely",
    deleteAssetMenu: "Delete Excel asset",
    replaceArchivedSuccess: "Replaced Excel asset with clipboard content and kept previous files as history.",
    replaceOverwriteSuccess: "Completely replaced Excel asset with clipboard content.",
    replaceFailed: "Failed to replace Excel asset.",
    unmanagedAssetPath: "Path is not a managed asset path",
    confirmDeleteAsset: "Delete this Excel asset block and the linked asset folder?",
    removeBlockFailed: "Failed to remove Excel asset block from the note.",
    assetDeleted: "Deleted Excel asset.",
    assetFolderDeleteFailed: "Failed to delete asset folder. The note block was removed.",
    currentNoteMissing: "Could not find the current note",
    sectionMissing: "Could not locate this rendered asset in the note. Refresh Reading view and try again.",
    historyPathFailed: "Could not create a history filename",
    nativeCopyFailed: "Windows native HTML copy failed. Retrying with browser clipboard fallback.",
    clipboardWriteApiUnavailable: "Clipboard API is unavailable.",
    textHtmlWriteUnavailable: "This environment cannot write text/html to the clipboard, so plain text was copied.",
    clipboardWriteUnavailable: "Clipboard write API is unavailable.",
    nativeHelperMissing: "Windows native clipboard helper was not found.",
    invalidMetaObject: "meta.json is not an object.",
    unsupportedAssetType: "Unsupported asset type.",
    unsupportedAssetVersion: "Unsupported asset version.",
    invalidMetaImage: "meta.image is invalid.",
    invalidMetaHtml: "meta.html is invalid.",
    invalidMetaSearch: "meta.search is invalid.",
    invalidMetaCreatedAt: "meta.createdAt is invalid."
  },
  ko: {
    pasteMenu: "Excel 표(HTML) 붙여넣기",
    readClipboardFailed: "클립보드에서 Excel HTML 데이터를 읽지 못했습니다.",
    noImageData: "이미지 데이터가 없어 HTML만 asset으로 저장합니다.",
    assetInserted: "Excel HTML asset을 삽입했습니다.",
    assetSaveFailed: "Excel HTML asset 저장에 실패했습니다.",
    clipboardReadApiUnavailable: "Clipboard read API를 사용할 수 없습니다.",
    clipboardReadFailed: "Clipboard 접근 권한이 없거나 읽기에 실패했습니다",
    noClipboardHtml: "클립보드에 text/html 데이터가 없습니다.",
    htmlBlobReadFailed: "HTML Blob을 텍스트로 변환하지 못했습니다",
    emptyClipboardHtml: "클립보드 HTML 데이터가 비어 있습니다.",
    nativeReadFailed: "Windows native HTML 읽기에 실패해 브라우저 클립보드로 저장합니다.",
    rollbackPartialFailed: "일부 생성 파일 rollback에 실패했습니다. 콘솔을 확인하세요.",
    missingAssetPath: "Excel HTML asset path가 없습니다.",
    missingMeta: "meta.json을 찾을 수 없습니다",
    readMetaFailed: "meta.json을 읽을 수 없습니다",
    missingHtmlAsset: "HTML asset을 찾을 수 없습니다",
    missingImageAsset: "이미지 asset을 찾을 수 없습니다",
    htmlOnlyAsset: "HTML-only Excel asset",
    copyHtmlAria: "Excel HTML 원본 복사",
    copyHtmlSuccess: "HTML 원본을 서식 포함 클립보드에 복사했습니다.",
    copyHtmlFailed: "HTML 원본 복사에 실패했습니다.",
    replaceWithHistory: "이력 남기고 Excel 표(HTML) 교체",
    replaceCompletely: "Excel 표(HTML) 완전 교체",
    deleteAssetMenu: "Excel asset 삭제",
    replaceArchivedSuccess: "Excel asset을 새 클립보드 내용으로 교체하고 이전 파일을 이력으로 보관했습니다.",
    replaceOverwriteSuccess: "Excel asset을 새 클립보드 내용으로 완전 교체했습니다.",
    replaceFailed: "Excel asset 교체에 실패했습니다.",
    unmanagedAssetPath: "관리 대상 asset 경로가 아닙니다",
    confirmDeleteAsset: "이 Excel asset 블록과 연결된 asset 폴더를 삭제할까요?",
    removeBlockFailed: "문서에서 Excel asset 블록을 제거하지 못했습니다.",
    assetDeleted: "Excel asset을 삭제했습니다.",
    assetFolderDeleteFailed: "asset 폴더 삭제에 실패했습니다. 문서 블록은 제거되었습니다.",
    currentNoteMissing: "현재 문서를 찾을 수 없습니다",
    sectionMissing: "렌더된 asset의 문서 위치를 찾지 못했습니다. 읽기 화면을 새로고침한 뒤 다시 시도하세요.",
    historyPathFailed: "이력 파일명을 만들 수 없습니다",
    nativeCopyFailed: "Windows native HTML 복사에 실패해 브라우저 클립보드 방식으로 재시도합니다.",
    clipboardWriteApiUnavailable: "Clipboard API를 사용할 수 없습니다.",
    textHtmlWriteUnavailable: "이 환경은 text/html 클립보드 쓰기를 지원하지 않아 일반 텍스트로 복사했습니다.",
    clipboardWriteUnavailable: "Clipboard write API를 사용할 수 없습니다.",
    nativeHelperMissing: "Windows native clipboard helper를 찾을 수 없습니다.",
    invalidMetaObject: "meta.json이 객체가 아닙니다.",
    unsupportedAssetType: "지원하지 않는 asset type입니다.",
    unsupportedAssetVersion: "지원하지 않는 asset version입니다.",
    invalidMetaImage: "meta.image 값이 올바르지 않습니다.",
    invalidMetaHtml: "meta.html 값이 올바르지 않습니다.",
    invalidMetaSearch: "meta.search 값이 올바르지 않습니다.",
    invalidMetaCreatedAt: "meta.createdAt 값이 올바르지 않습니다."
  }
};

export default class ExcelHtmlPastePlugin extends Plugin {
  private locale: Locale = "en";

  async onload() {
    this.locale = getLanguage().toLowerCase().startsWith("ko") ? "ko" : "en";

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        menu.addItem((item) => {
          item
            .setTitle(this.t("pasteMenu"))
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

  private t(key: string): string {
    return STRINGS[this.locale][key] ?? STRINGS.en[key] ?? key;
  }

  private async handleExcelPaste(editor: Editor, sourcePath: string | null): Promise<void> {
    let payload: ClipboardExcelPayload;

    try {
      payload = await this.readExcelClipboard();
    } catch (error) {
      this.reportError(this.t("readClipboardFailed"), error);
      return;
    }

    if (!payload.imageBuffer) {
      new Notice(this.t("noImageData"));
    }

    try {
      const asset = await this.createExcelAsset(payload, sourcePath);
      editor.replaceSelection(this.buildCodeBlock(asset.metaPath));
      new Notice(this.t("assetInserted"));
    } catch (error) {
      this.reportError(this.t("assetSaveFailed"), error);
    }
  }

  private async readExcelClipboard(): Promise<ClipboardExcelPayload> {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
      throw new Error(this.t("clipboardReadApiUnavailable"));
    }

    let items: ClipboardItems;
    try {
      items = await navigator.clipboard.read();
    } catch (error) {
      throw new Error(`${this.t("clipboardReadFailed")}: ${this.errorMessage(error)}`);
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
      throw new Error(this.t("noClipboardHtml"));
    }

    let html: string | null = nativeHtml;
    if (!html && htmlBlob) {
      try {
        html = await htmlBlob.text();
      } catch (error) {
        throw new Error(`${this.t("htmlBlobReadFailed")}: ${this.errorMessage(error)}`);
      }
    }

    if (!html?.trim()) {
      throw new Error(this.t("emptyClipboardHtml"));
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
      return null;
    }

    try {
      return await this.runNativeHelper(["read-html"], "");
    } catch (error) {
      console.warn(`Native clipboard read failed via ${helperPath}; falling back to browser clipboard.`, error);
      new Notice(this.t("nativeReadFailed"));
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
      new Notice(this.t("rollbackPartialFailed"));
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
      this.renderError(el, this.t("missingAssetPath"));
      return;
    }

    const metaFile = this.getFile(metaPath);
    if (!metaFile) {
      this.renderError(el, `${this.t("missingMeta")}: ${metaPath}`);
      return;
    }

    let meta: ExcelAssetMeta;
    try {
      meta = this.validateMeta(JSON.parse(await this.app.vault.read(metaFile)));
    } catch (error) {
      this.renderError(el, `${this.t("readMetaFailed")}: ${this.errorMessage(error)}`);
      return;
    }

    const basePath = metaPath.substring(0, metaPath.lastIndexOf("/"));
    const htmlPath = `${basePath}/${meta.html}`;
    const htmlFile = this.getFile(htmlPath);
    if (!htmlFile) {
      this.renderError(el, `${this.t("missingHtmlAsset")}: ${htmlPath}`);
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
          text: `${this.t("missingImageAsset")}: ${imagePath}`
        });
      }
    } else {
      wrapper.createDiv({
        cls: "excel-html-fallback",
        text: this.t("htmlOnlyAsset")
      });
    }

    const button = wrapper.createEl("button", {
      cls: "excel-html-copy-button",
      text: "HTML",
      attr: {
        type: "button",
        "aria-label": this.t("copyHtmlAria")
      }
    });

    button.addEventListener("click", async () => {
      try {
        const html = await this.app.vault.read(htmlFile);
        await this.writeHtmlToClipboard(html);
        new Notice(this.t("copyHtmlSuccess"));
      } catch (error) {
        this.reportError(this.t("copyHtmlFailed"), error);
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
          .setTitle(this.t("replaceWithHistory"))
          .setIcon("replace")
          .onClick(async () => {
            await this.replaceRenderedAsset(processorEl, ctx, asset, "archive");
          });
      });
      menu.addItem((item) => {
        item
          .setTitle(this.t("replaceCompletely"))
          .setIcon("refresh-cw")
          .onClick(async () => {
            await this.replaceRenderedAsset(processorEl, ctx, asset, "overwrite");
          });
      });
      menu.addItem((item) => {
        item
          .setTitle(this.t("deleteAssetMenu"))
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
    currentAsset: RenderedAsset,
    mode: ReplacementMode
  ): Promise<void> {
    try {
      const payload = await this.readExcelClipboard();
      const updatedAt = await this.replaceAssetFilesInPlace(currentAsset, payload, ctx.sourcePath, mode);
      await this.replaceRenderedCodeBlock(el, ctx, this.buildCodeBlockSection(currentAsset.metaPath, updatedAt));
      const message = mode === "archive"
        ? this.t("replaceArchivedSuccess")
        : this.t("replaceOverwriteSuccess");
      new Notice(message);
    } catch (error) {
      this.reportError(this.t("replaceFailed"), error);
    }
  }

  private async replaceAssetFilesInPlace(
    asset: RenderedAsset,
    payload: ClipboardExcelPayload,
    sourcePath: string | null,
    mode: ReplacementMode
  ): Promise<string> {
    if (!this.isManagedAssetPath(asset.basePath)) {
      throw new Error(`${this.t("unmanagedAssetPath")}: ${asset.basePath}`);
    }

    const archivedFiles = mode === "archive" ? await this.archiveActiveAssetFiles(asset) : [];
    let snapshot: Map<string, string | ArrayBuffer | null> | null = null;

    try {
      if (mode === "overwrite") {
        snapshot = await this.snapshotActiveAssetFiles(asset);
      }

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
      if (mode === "overwrite") {
        await this.deleteAssetHistoryFiles(asset.basePath);
      }
      return updatedAt;
    } catch (error) {
      if (mode === "archive") {
        await this.rollbackInPlaceReplacement(asset, archivedFiles);
      } else if (snapshot) {
        await this.rollbackOverwriteReplacement(asset, snapshot);
      }
      throw error;
    }
  }

  private async snapshotActiveAssetFiles(asset: RenderedAsset): Promise<Map<string, string | ArrayBuffer | null>> {
    const snapshot = new Map<string, string | ArrayBuffer | null>();
    const paths = [
      asset.htmlPath,
      `${asset.basePath}/table.png`,
      `${asset.basePath}/table.search.md`,
      asset.metaPath
    ];

    for (const path of paths) {
      if (!(await this.app.vault.adapter.exists(path))) {
        snapshot.set(path, null);
        continue;
      }

      if (path.endsWith(".png")) {
        snapshot.set(path, await this.app.vault.adapter.readBinary(path));
      } else {
        snapshot.set(path, await this.app.vault.adapter.read(path));
      }
    }

    return snapshot;
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

  private async deleteAssetHistoryFiles(basePath: string): Promise<void> {
    if (!this.isManagedAssetPath(basePath)) {
      throw new Error(`${this.t("unmanagedAssetPath")}: ${basePath}`);
    }

    if (!(await this.app.vault.adapter.exists(basePath))) {
      return;
    }

    const listed = await this.app.vault.adapter.list(basePath);
    const historyPattern = /\/(?:table-\d{8}-\d{6}(?:-\d+)?\.(?:html|png)|table\.search-\d{8}-\d{6}(?:-\d+)?\.md|meta-\d{8}-\d{6}(?:-\d+)?\.json)$/;

    for (const path of listed.files) {
      if (historyPattern.test(path)) {
        await this.app.vault.adapter.remove(path);
      }
    }
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

  private async rollbackOverwriteReplacement(
    asset: RenderedAsset,
    snapshot: Map<string, string | ArrayBuffer | null>
  ): Promise<void> {
    for (const [path, data] of snapshot.entries()) {
      try {
        if (data === null) {
          if (await this.app.vault.adapter.exists(path)) {
            await this.app.vault.adapter.remove(path);
          }
        } else if (data instanceof ArrayBuffer) {
          await this.app.vault.adapter.writeBinary(path, data);
        } else {
          await this.app.vault.adapter.write(path, data);
        }
      } catch (error) {
        console.error(`Failed to rollback overwritten asset file: ${path}`, error);
      }
    }

    if (!(await this.app.vault.adapter.exists(asset.basePath))) {
      await this.app.vault.adapter.mkdir(asset.basePath);
    }
  }

  private async deleteRenderedAsset(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    asset: RenderedAsset
  ): Promise<void> {
    if (!window.confirm(this.t("confirmDeleteAsset"))) {
      return;
    }

    try {
      await this.replaceRenderedCodeBlock(el, ctx, "");
    } catch (error) {
      this.reportError(this.t("removeBlockFailed"), error);
      return;
    }

    try {
      await this.deleteAssetFolder(asset.basePath);
      new Notice(this.t("assetDeleted"));
    } catch (error) {
      this.reportError(this.t("assetFolderDeleteFailed"), error);
    }
  }

  private async replaceRenderedCodeBlock(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    replacement: string
  ): Promise<void> {
    const sourceFile = this.getFile(ctx.sourcePath);
    if (!sourceFile) {
      throw new Error(`${this.t("currentNoteMissing")}: ${ctx.sourcePath}`);
    }

    const section = ctx.getSectionInfo(el);
    if (!section) {
      throw new Error(this.t("sectionMissing"));
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
      throw new Error(`${this.t("unmanagedAssetPath")}: ${basePath}`);
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

    throw new Error(`${this.t("historyPathFailed")}: ${path}`);
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

    if (this.isWindowsDesktop() && this.getNativeHelperPath()) {
      try {
        await this.writeHtmlWithNativeClipboard(normalizedHtml, plainText);
        return;
      } catch (error) {
        console.warn("Native clipboard helper failed; falling back to browser clipboard.", error);
        new Notice(this.t("nativeCopyFailed"));
      }
    }

    if (!navigator.clipboard) {
      throw new Error(this.t("clipboardWriteApiUnavailable"));
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
      new Notice(this.t("textHtmlWriteUnavailable"));
      return;
    }

    throw new Error(this.t("clipboardWriteUnavailable"));
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
    const helperPath = join(this.app.vault.adapter.getBasePath(), pluginDir, "bin", helperName);
    return existsSync(helperPath) ? helperPath : null;
  }

  private runNativeHelper(args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const helperPath = this.getNativeHelperPath();
      if (!helperPath) {
        reject(new Error(this.t("nativeHelperMissing")));
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
      throw new Error(this.t("invalidMetaObject"));
    }

    const meta = value as Partial<ExcelAssetMeta>;
    if (meta.type !== ASSET_TYPE) {
      throw new Error(this.t("unsupportedAssetType"));
    }

    if (meta.version !== 1) {
      throw new Error(this.t("unsupportedAssetVersion"));
    }

    if (meta.image !== null && typeof meta.image !== "string") {
      throw new Error(this.t("invalidMetaImage"));
    }

    if (typeof meta.html !== "string" || !meta.html) {
      throw new Error(this.t("invalidMetaHtml"));
    }

    if (meta.search !== undefined && typeof meta.search !== "string") {
      throw new Error(this.t("invalidMetaSearch"));
    }

    if (typeof meta.createdAt !== "string" || !meta.createdAt) {
      throw new Error(this.t("invalidMetaCreatedAt"));
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
