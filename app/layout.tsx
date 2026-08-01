import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Chance Atoms — AI 创作工作台";
const description =
  "在同一个 AI 工作台中持续对话，或从一句话开始规划、生成、运行和迭代完整的单文件 Web App。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host") || "localhost:3000";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || (host.startsWith("localhost") ? "http" : "https");

  let metadataBase: URL;
  try {
    metadataBase = new URL(`${protocol}://${host}`);
  } catch {
    metadataBase = new URL("http://localhost:3000");
  }

  return {
    metadataBase,
    title: { default: title, template: "%s · Chance Atoms" },
    description,
    applicationName: "Chance Atoms",
    keywords: [
      "AI 工作台",
      "AI 对话",
      "AI Web App Builder",
      "BuildPlan",
      "WebAppArtifact",
      "vibe coding",
    ],
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "Chance Atoms",
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
