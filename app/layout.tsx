import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Forge — AI Web App Builder";
const description =
  "用一句话描述 Web App，审阅模型生成的 BuildPlan，再生成、运行、迭代和导出完整单文件应用。";

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

  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: { default: title, template: "%s · Forge" },
    description,
    applicationName: "Forge",
    keywords: ["AI Web App Builder", "BuildPlan", "WebAppArtifact", "vibe coding"],
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "Forge",
      locale: "zh_CN",
      images: [
        {
          url: socialImage,
          width: 1744,
          height: 928,
          alt: "Forge — AI Web App Builder",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
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
