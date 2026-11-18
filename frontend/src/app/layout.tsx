import type { Metadata } from "next";
import { Noto_Sans_JP, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const notoSansJp = Noto_Sans_JP({
  variable: "--font-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "QuakeLens Japan | 建物築年 × 地震ハザード 防災可視化ダッシュボード",
  description:
    "Project PLATEAUの建物データとJ-SHIS地震ハザード・表層地盤情報を統合し、Gemini AIが地域の防災特徴を解説するWebアプリケーション",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSansJp.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-slate-950 text-slate-100 font-sans">
        {children}
      </body>
    </html>
  );
}
