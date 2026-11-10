import {defineConfig, globalIgnores} from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// Next 16 提供原生 flat config，不再經由 FlatCompat 轉換。
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // beUI 元件是從上游 registry 原樣複製的原始碼（授權見 vendor/beui.LICENSE），保持不改以便日後更新；
    // 這幾條 React Compiler 嚴格規則對上游寫法誤報，只在 vendored 目錄關閉，專案自己的程式不受影響。
    files: ['src/components/motion/**', 'src/components/charts/**'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  globalIgnores(['.next/**', '.open-next/**', '.wrangler/**', 'out/**', 'build/**', 'next-env.d.ts', 'cloudflare-env.d.ts']),
]);
