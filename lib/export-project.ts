import type { AppRecord, AppSpec, StoredArtifact, WebAppArtifact } from "./domain";
import { compileAppToHtml } from "./compile-app";
import {
  isWebAppArtifact,
  parseAppSpec,
  parseRecords,
  parseStoredArtifact,
} from "./validation";

const UTF8_FLAG = 0x0800;
const STORED_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = 0x0021;
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface StandaloneProjectInput {
  spec?: unknown;
  artifact?: unknown;
  records?: unknown;
  projectId?: unknown;
}

export interface StandaloneProjectFile {
  name: string;
  content: string;
}

export interface StandaloneProjectExport {
  fileName: string;
  files: StandaloneProjectFile[];
  archive: Uint8Array;
}

type EncodedZipEntry = {
  name: Uint8Array;
  content: Uint8Array;
  crc: number;
  offset: number;
};

const encoder = new TextEncoder();

function standalonePersistenceScript(storageKey: string): string {
  return `  <script>
    (() => {
      "use strict";
      const node = document.getElementById("forge-data");
      if (!node) return;

      try {
        const bootstrap = JSON.parse(node.textContent || "{}");
        const storageKey = ${JSON.stringify(storageKey)};
        const fields = new Map((bootstrap.spec?.fields || []).map((field) => [field.id, field]));
        const valueMatches = (entry) => {
          if (!entry || typeof entry !== "object" || typeof entry.fieldId !== "string") return false;
          const field = fields.get(entry.fieldId);
          if (!field) return false;
          if (field.type === "number") return typeof entry.value === "number" && Number.isFinite(entry.value);
          if (field.type === "checkbox") return typeof entry.value === "boolean";
          if (typeof entry.value !== "string" || entry.value.length > 2000) return false;
          return field.type !== "select" || entry.value === "" || field.options.includes(entry.value);
        };
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const records = JSON.parse(stored);
          const ids = new Set();
          const valid = Array.isArray(records) && records.length <= 100 && records.every((record) => {
            if (!record || typeof record !== "object" || typeof record.id !== "string" ||
                !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.id) || ids.has(record.id) ||
                !Array.isArray(record.values) || record.values.length > fields.size) return false;
            ids.add(record.id);
            const fieldIds = new Set();
            return record.values.every((entry) => {
              if (!valueMatches(entry) || fieldIds.has(entry.fieldId)) return false;
              fieldIds.add(entry.fieldId);
              return true;
            });
          });
          if (valid) {
            bootstrap.records = records;
            node.textContent = JSON.stringify(bootstrap);
          } else {
            window.localStorage.removeItem(storageKey);
          }
        }

        window.addEventListener("message", (event) => {
          if (event.source !== window) return;
          const message = event.data;
          if (!message || message.source !== "forge-preview" || message.type !== "records-change") return;
          if (message.projectId !== bootstrap.projectId || !Array.isArray(message.records)) return;
          window.localStorage.setItem(storageKey, JSON.stringify(message.records));
        });
      } catch {
        // Storage can be unavailable in privacy modes. The app remains usable
        // for the current session even when persistence cannot be enabled.
      }
    })();
  </script>`;
}

function assertSafeProjectId(value: unknown): string {
  if (value === undefined) return "standalone-app";
  if (typeof value !== "string" || !SAFE_PROJECT_ID.test(value)) {
    throw new TypeError("projectId contains unsupported characters");
  }
  return value;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "generated-app";
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, "\\$&").replace(/\s+/g, " ").trim();
}

function addStandalonePersistence(html: string, storageKey: string): string {
  const dataScriptStart = html.indexOf('<script id="forge-data"');
  if (dataScriptStart < 0) {
    throw new Error("Compiled app is missing its bootstrap data");
  }
  const dataScriptEnd = html.indexOf("</script>", dataScriptStart);
  if (dataScriptEnd < 0) {
    throw new Error("Compiled app has an incomplete bootstrap script");
  }
  const insertionPoint = dataScriptEnd + "</script>".length;
  return `${html.slice(0, insertionPoint)}\n${standalonePersistenceScript(storageKey)}${html.slice(insertionPoint)}`;
}

function createDataAppReadme(spec: AppSpec): string {
  const title = markdownText(spec.title);
  const description = markdownText(spec.description);
  return `# ${title}

${description}

这是由 Chance Atoms Demo 导出的独立静态应用。

## 运行

建议在当前目录启动任意静态文件服务：

\`\`\`bash
npx serve .
\`\`\`

直接双击 \`index.html\` 也可以预览，但不同浏览器对 \`file://\` 页面存储的支持并不一致；需要验证刷新后保存时，请使用静态文件服务。

## 项目文件

- \`index.html\`：完整应用，CSS 与 JavaScript 已内嵌，无需安装依赖或构建。
- \`app-spec.json\`：生成该应用所使用的结构化 AppSpec。

## 数据与安全

- 数据保存在当前浏览器的 localStorage 中；刷新页面后仍会保留。
- 不包含 API 密钥、后端接口或远程请求，可部署到任意静态托管平台。
- 页面启用了 Content Security Policy，生成内容只作为数据渲染，不执行任意生成代码。

## 边界

此导出包是单用户、设备本地的静态版本。多人协作、云端数据库、AI 再生成和版本回滚仍由 Chance Atoms Demo 主应用提供。
`;
}

function createWebAppReadme(artifact: WebAppArtifact): string {
  const title = markdownText(artifact.title);
  const description = markdownText(artifact.description);
  return `# ${title}

${description}

这是由 Chance Atoms Demo 导出的独立 Web App。

## 运行

建议在当前目录启动任意静态文件服务：

\`\`\`bash
npx serve .
\`\`\`

也可以直接双击 \`index.html\` 预览；如果浏览器限制本地文件能力，请改用静态文件服务。

## 项目文件

- \`index.html\`：生成模型输出的完整网页，CSS 与 JavaScript 已内嵌。
- \`artifact.json\`：本次生成所保存的 Web App Artifact 与验收标准。

## 数据与安全

- 导出包不包含 API 密钥，也不会连接 Chance Atoms Demo 的项目数据库。
- 网页按生成时的完整状态独立运行；浏览器端数据行为由 \`index.html\` 自身实现。
- 在公开部署前，请根据实际用途复核页面交互、外部资源和浏览器权限。
`;
}

function parseExportArtifact(input: StandaloneProjectInput): StoredArtifact {
  const value = input.artifact ?? input.spec;
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "web_app"
  ) {
    try {
      return parseStoredArtifact(value);
    } catch {
      throw new TypeError("artifact must be a valid Web App Artifact");
    }
  }
  return parseAppSpec(value);
}

function normalizeArchivePath(name: string): string {
  if (
    name.length === 0 ||
    name.length > 180 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`Unsafe archive path: ${name}`);
  }
  return name;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

/**
 * Creates a standards-compliant ZIP using the "stored" method. Generated apps
 * are small text projects, so avoiding compression keeps this Edge-compatible
 * and removes the need for a ZIP dependency or Node-only APIs.
 */
export function createZipArchive(files: StandaloneProjectFile[]): Uint8Array {
  if (files.length < 1 || files.length > 20) {
    throw new TypeError("An export must contain between 1 and 20 files");
  }

  const names = new Set<string>();
  const entries: EncodedZipEntry[] = [];
  const localParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const safeName = normalizeArchivePath(file.name);
    if (names.has(safeName)) throw new TypeError(`Duplicate archive path: ${safeName}`);
    names.add(safeName);

    const name = encoder.encode(safeName);
    const content = encoder.encode(file.content);
    if (content.byteLength > MAX_ARCHIVE_BYTES) {
      throw new TypeError(`Export file is too large: ${safeName}`);
    }
    const crc = crc32(content);
    const header = concatBytes([
      uint32(0x04034b50),
      uint16(20),
      uint16(UTF8_FLAG),
      uint16(STORED_METHOD),
      uint16(DOS_TIME),
      uint16(DOS_DATE),
      uint32(crc),
      uint32(content.byteLength),
      uint32(content.byteLength),
      uint16(name.byteLength),
      uint16(0),
      name,
    ]);
    localParts.push(header, content);
    entries.push({ name, content, crc, offset });
    offset += header.byteLength + content.byteLength;
  }

  if (offset > MAX_ARCHIVE_BYTES) throw new TypeError("Export archive is too large");

  const centralParts: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of entries) {
    const central = concatBytes([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(UTF8_FLAG),
      uint16(STORED_METHOD),
      uint16(DOS_TIME),
      uint16(DOS_DATE),
      uint32(entry.crc),
      uint32(entry.content.byteLength),
      uint32(entry.content.byteLength),
      uint16(entry.name.byteLength),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(entry.offset),
      entry.name,
    ]);
    centralParts.push(central);
    centralSize += central.byteLength;
  }

  const end = concatBytes([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(centralSize),
    uint32(offset),
    uint16(0),
  ]);

  return concatBytes([...localParts, ...centralParts, end]);
}

export function createStandaloneProject(
  input: StandaloneProjectInput,
): StandaloneProjectExport {
  const artifact = parseExportArtifact(input);
  const projectId = assertSafeProjectId(input.projectId);

  if (isWebAppArtifact(artifact)) {
    const files: StandaloneProjectFile[] = [
      { name: "index.html", content: artifact.html },
      { name: "artifact.json", content: `${JSON.stringify(artifact, null, 2)}\n` },
      { name: "README.md", content: createWebAppReadme(artifact) },
    ];
    return {
      fileName: `${slugify(artifact.title)}-standalone.zip`,
      files,
      archive: createZipArchive(files),
    };
  }

  const spec = artifact;
  const records: AppRecord[] = parseRecords(input.records ?? spec.seedData, spec);
  const specFingerprint = crc32(encoder.encode(JSON.stringify(spec)))
    .toString(16)
    .padStart(8, "0");
  const storageKey = `chance-atoms:standalone:${projectId}:${specFingerprint}`;
  const html = addStandalonePersistence(
    compileAppToHtml(spec, records, projectId),
    storageKey,
  );
  const files: StandaloneProjectFile[] = [
    { name: "index.html", content: html },
    { name: "app-spec.json", content: `${JSON.stringify(spec, null, 2)}\n` },
    { name: "README.md", content: createDataAppReadme(spec) },
  ];

  return {
    fileName: `${slugify(spec.title)}-standalone.zip`,
    files,
    archive: createZipArchive(files),
  };
}
