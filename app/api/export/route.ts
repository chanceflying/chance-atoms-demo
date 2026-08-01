import { NextResponse } from "next/server";
import { createStandaloneProject } from "@/lib/export-project";
import { AppSpecValidationError } from "@/lib/validation";

const MAX_REQUEST_BYTES = 1_000_000;

type ExportBody = {
  spec?: unknown;
  records?: unknown;
  projectId?: unknown;
};

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "导出内容过大。" }, { status: 413 });
  }

  let body: ExportBody;
  try {
    const raw = await request.text();
    if (encoderLength(raw) > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "导出内容过大。" }, { status: 413 });
    }
    body = JSON.parse(raw) as ExportBody;
  } catch {
    return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  }

  if (!body.spec) {
    return NextResponse.json({ error: "缺少可导出的应用版本。" }, { status: 400 });
  }

  try {
    const result = createStandaloneProject({
      spec: body.spec,
      records: body.records,
      projectId: body.projectId,
    });
    const responseBody = result.archive.buffer.slice(
      result.archive.byteOffset,
      result.archive.byteOffset + result.archive.byteLength,
    ) as ArrayBuffer;

    return new Response(responseBody, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppSpecValidationError || error instanceof TypeError) {
      return NextResponse.json(
        { error: "当前应用数据不完整，无法安全导出。" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "导出失败，请稍后重试。" }, { status: 500 });
  }
}

function encoderLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
