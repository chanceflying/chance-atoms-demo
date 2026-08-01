import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Forge — 把需求锻造成可用应用";
const description =
  "用一句话描述内部工具，审阅 AI 计划，生成并迭代一个真正可操作、可保存的网页应用。";

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
    keywords: ["AI app builder", "AppSpec", "internal tools", "vibe coding"],
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
          alt: "Forge — 把需求锻造成可用应用",
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
