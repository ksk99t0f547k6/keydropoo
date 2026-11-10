import { Geist, Geist_Mono } from "next/font/google";

// 控制台與公開頁共用的字型；分享卡片也讀 --font-dashboard。
export const sans = Geist({ subsets: ["latin"], variable: "--font-dashboard", display: "swap" });
export const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-dashboard-mono", display: "swap" });
