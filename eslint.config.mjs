import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";

/**
 * 순수 모듈 경계 — DOC-010 §5 DEP-01 ~ DEP-04
 *
 * `lib/tax`·`lib/domain`의 순수성은 규율이 아니라 린트로 강제한다(DEP-04).
 * 이 규칙이 없으면 CLAUDE.md 절대 규칙 #3을 지킬 강제 수단이 없다.
 */
const PURE_MODULES = ["src/lib/tax/**/*.ts", "src/lib/domain/**/*.ts"];

/** DEP-01 — 순수 모듈이 import할 수 없는 계층 */
const FORBIDDEN_LAYERS = [
  "./src/lib/db",
  "./src/lib/providers",
  "./src/lib/auth",
  "./src/app",
  "./src/components",
];

/** DEP-02 — 프레임워크 API 및 I/O·환경변수 접근 수단 */
const FORBIDDEN_PACKAGES = [
  "next",
  "next/*",
  "react",
  "react-dom",
  "react-dom/*",
  "server-only",
  "client-only",
  "@supabase/*",
  "fs",
  "node:fs",
  "node:fs/*",
  "path",
  "node:path",
  "http",
  "https",
  "node:http",
  "node:https",
  "net",
  "node:net",
  "os",
  "node:os",
  "crypto",
  "node:crypto",
  "child_process",
  "node:child_process",
  "process",
  "node:process",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    name: "els/pure-modules",
    files: PURE_MODULES,
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
    rules: {
      // DEP-01 — 경로 해석 기반. 별칭(@/lib/db)과 상대경로(../db) 우회를 모두 차단한다.
      "import/no-restricted-paths": [
        "error",
        {
          basePath: import.meta.dirname,
          zones: [
            {
              target: "./src/lib/tax",
              from: FORBIDDEN_LAYERS,
              message:
                "DEP-01: lib/tax은 데이터·프레임워크 계층을 import할 수 없다. 필요한 값은 인자로 주입받는다.",
            },
            {
              target: "./src/lib/domain",
              from: FORBIDDEN_LAYERS,
              message:
                "DEP-01: lib/domain은 데이터·프레임워크 계층을 import할 수 없다. 필요한 값은 인자로 주입받는다.",
            },
          ],
        },
      ],

      // DEP-02 — 프레임워크 API·I/O·환경변수 차단
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: FORBIDDEN_PACKAGES,
              message:
                "DEP-02: 순수 모듈은 프레임워크 API와 I/O를 사용하지 않는다. 계산에 필요한 값은 인자로 주입받는다.",
            },
          ],
        },
      ],

      // DEP-02 보강 — 결정성. 서버·클라이언트에서 동일 결과를 보장해야 하므로
      // 현재 시각·난수에 의존할 수 없다(ADR-003). 기준일은 항상 인자로 받는다.
      "no-restricted-globals": [
        "error",
        {
          name: "process",
          message: "DEP-02: 순수 모듈은 환경변수에 접근하지 않는다.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message:
            "ADR-003: 순수 모듈은 현재 시각에 의존할 수 없다. 기준일을 인자로 받는다.",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "ADR-003: 순수 모듈은 현재 시각에 의존할 수 없다. 기준일을 인자로 받는다.",
        },
        {
          selector:
            "MemberExpression[object.name='Math'][property.name='random']",
          message: "ADR-003: 순수 모듈은 난수를 사용할 수 없다.",
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 생성물 — `npm run db:types`가 덮어쓴다. 손으로 고칠 대상이 아니므로
    // 린트하지 않는다. 스키마와의 신선도는 tests/integration의 드리프트
    // 대조가 본다(AQ-19).
    "src/types/database.types.ts",
  ]),
]);

export default eslintConfig;
