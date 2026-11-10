// 部署者可切換公開功能與管理員郵件；停用我的碼時由伺服器拒絕存取。
export const siteFeatures={myCodes:true,adminNotificationEmail:true} as const;

// 頁尾的「Powered by Keydrop」連結。MIT 授權不要求顯示，可以關掉；保留的話是對專案很大的支持。
export const poweredBy={enabled:true,url:'https://keydrop.allright.dev'} as const;

export const optionalPageNames = ['docs', 'pricing', 'demo', 'changelog'] as const;
export type OptionalPage = typeof optionalPageNames[number];
// 首頁區塊：可刪減或調整順序。文案在 messages/<語言>.json 的 home 與 publicSite.start*。
export type HomeSection = 'hero' | 'logos' | 'features' | 'steps' | 'facts' | 'start';

// 品牌與文案在 messages/en.json；區塊依此順序呈現，選配頁面預設關閉。
export const publicSite: {
  sections: HomeSection[];
  pages: Record<OptionalPage, boolean>;
  organizationName: string | null;
  /** 首頁「開源」徽章與 GitHub 按鈕連到的倉庫；設成 null 就不顯示。 */
  repositoryUrl: string | null;
} = {
  sections: ['hero', 'logos', 'features', 'steps', 'facts', 'start'],
  pages: { docs: false, pricing: false, demo: false, changelog: false },
  organizationName: null,
  repositoryUrl: 'https://github.com/all-right-LLC/keydrop',
};

export function isPublicPageEnabled(page: string): page is OptionalPage {
  return optionalPageNames.some(name => name === page && publicSite.pages[name]);
}

export function publicPaths() {
  return ['/', '/features', ...optionalPageNames.filter(name => publicSite.pages[name]).map(name => `/${name}`)];
}
