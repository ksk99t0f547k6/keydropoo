import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, LOCALE_HEADER, localizedPath, splitLocalePath } from "@/i18n/locales";

// 語言網址：/ja/features 內部改寫成 /features，並用請求標頭告訴頁面要用日文。
// 同時記住這個語言，之後點到不帶前綴的頁面（登入、我的碼）也維持同一種語言。
export function proxy(request: NextRequest) {
  const { locale, path } = splitLocalePath(request.nextUrl.pathname);
  if (!locale) {
    // 語言標頭只能由這裡設定，不信任用戶端自己送來的值。
    if (!request.headers.has(LOCALE_HEADER)) return NextResponse.next();
    const headers = new Headers(request.headers);
    headers.delete(LOCALE_HEADER);
    return NextResponse.next({ request: { headers } });
  }
  const requested = request.nextUrl.pathname.split("/")[1];
  // 大小寫不同（/zh-hant）時導向標準寫法，避免重複網址。
  if (requested !== locale) {
    const url = request.nextUrl.clone();
    url.pathname = localizedPath(locale, path);
    return NextResponse.redirect(url, 308);
  }
  const url = request.nextUrl.clone();
  url.pathname = path;
  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  const response = NextResponse.rewrite(url, { request: { headers } });
  if (request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 31536000, sameSite: "lax" });
  }
  return response;
}

// 後台、API、MCP、Next 內部檔案與靜態檔不經過語言改寫。
export const config = {
  matcher: ["/((?!api/|_next/|dashboard|mcp|.*\\..*).*)"],
};
