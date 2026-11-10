import { getRequestConfig } from "next-intl/server";
import { loadMessages } from "./messages";
import { requestLocale } from "./server-locale";

// 公開頁面可用 /ja/… 這類語言網址；不帶前綴時看語言選單選過的 cookie，再依瀏覽器 Accept-Language。
// 這樣分享出去的領碼連結會自動用收件人的語言顯示。
export default getRequestConfig(async () => {
  const locale = await requestLocale();
  return { locale, messages: await loadMessages(locale) };
});
