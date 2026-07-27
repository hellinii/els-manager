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

/**
 * 데이터 접근 계층 경계 — DOC-010 §5, §7.2 (P3a 3단계)
 *
 * `lib/db`가 생기기 **전에** 규칙을 세운다. 나중에 덧붙이면 규율일 뿐이고,
 * 규율은 다음 사람이 지키지 않는다 — DEP-04가 순수 모듈에 쓴 논거와 같다.
 */
const DB_MODULES = ["src/lib/db/**/*.ts"];

/** next에 닿을 수 있는 유일한 파일 — 나머지는 Next 없이 테스트 가능해야 한다 */
const DB_NEXT_BOUNDARY = ["src/lib/db/server.ts"];

/** process.env를 읽을 수 있는 유일한 파일 — "service_role을 읽지 않는다"를 한 곳에서 감사한다 */
const DB_ENV_BOUNDARY = ["src/lib/db/env.ts"];

/**
 * DOC-011 §4.0 Q-08 — 금액·비율은 경계에서 문자열로 받는다(`::text` 캐스팅).
 * 강제 변환 수단은 캐스팅을 빠뜨린 경로를 float64로 "고쳐서" 덮어버린다.
 * `numeric(15,0)`은 15자리까지 float64로 정확히 표현되므로 값 단언으로는
 * 영원히 드러나지 않는다 — 그래서 값이 아니라 변환 수단 자체를 막는다.
 */
const NO_COERCION_GLOBALS = [
  {
    name: "parseFloat",
    message:
      "DOC-011 §4.0 Q-08: 금액·비율은 문자열로 유지한다. parseFloat는 캐스팅 누락을 float64로 덮어버린다 — Decimal에 문자열을 넘긴다.",
  },
  {
    name: "parseInt",
    message:
      "DOC-011 §4.0 Q-08: 금액·비율은 문자열로 유지한다. 계산이 필요하면 Decimal에 넘긴다.",
  },
];

const NO_COERCION_SYNTAX = [
  {
    selector: "CallExpression[callee.name='Number']",
    message:
      "DOC-011 §4.0 Q-08: 금액·비율은 문자열로 유지한다. Number()는 캐스팅 누락을 float64로 덮어버린다 — Decimal에 문자열을 넘긴다.",
  },
  {
    // 전역 parseFloat를 막으면서 Number.parseFloat를 열어 두면 우회로가 남는다.
    // Number.parseInt는 의도적으로 허용한다 — 연도·차수·개월수는 개수를 세는
    // 정수이며 decimal.ts가 그 값들을 number로 쓰기로 이미 정했다. 금액·비율에는
    // 정수 파싱이 필요한 경우가 없다.
    selector:
      "MemberExpression[object.name='Number'][property.name='parseFloat']",
    message:
      "DOC-011 §4.0 Q-08: Number.parseFloat도 강제 변환이다. 금액·비율은 문자열로 유지하고 Decimal에 넘긴다.",
  },
  {
    selector: "UnaryExpression[operator='+'][argument.type!='Literal']",
    message:
      "DOC-011 §4.0 Q-08: 단항 +는 숫자 강제 변환이다. 금액·비율은 문자열로 유지하고 Decimal에 넘긴다.",
  },
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

  {
    name: "els/db-layer",
    files: DB_MODULES,
    ignores: [...DB_NEXT_BOUNDARY, ...DB_ENV_BOUNDARY],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "DB 계층은 Next를 import하지 않는다. next/headers 결선은 src/lib/db/server.ts 하나에만 둔다 — 나머지가 프레임워크 없이 테스트 가능해야 조회 계약을 DB 없이·Next 없이 검증할 수 있다.",
            },
          ],
        },
      ],
    },
  },

  /**
   * ★ 두 규칙(`no-restricted-globals`·`no-restricted-syntax`)을 **한 객체에**
   * 모아 둔다. 플랫 설정에서 뒤에 오는 객체가 같은 이름의 규칙을 다시 선언하면
   * 앞의 설정을 **병합하지 않고 대체한다** — 강제 변환 금지를 별 객체로 떼어
   * 놓으면 `process` 금지가 소리 없이 사라진다. 규칙 이름당 파일 집합별로
   * 선언은 한 번씩만 있어야 한다.
   */
  {
    name: "els/db-layer-values-and-env",
    files: DB_MODULES,
    ignores: DB_ENV_BOUNDARY,
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "process",
          message:
            "환경변수는 src/lib/db/env.ts에서만 읽는다 (DOC-010 §7.2). 그 파일 하나로 service_role 부재를 감사한다.",
        },
        ...NO_COERCION_GLOBALS,
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            "환경변수는 src/lib/db/env.ts에서만 읽는다 (DOC-010 §7.2). 그 파일 하나로 service_role 부재를 감사한다.",
        },
        ...NO_COERCION_SYNTAX,
      ],
    },
  },

  {
    // env.ts만 process.env를 읽는다. 강제 변환 금지는 여기에도 그대로 적용되므로
    // 위 객체가 대체될 것을 감안해 다시 선언한다 — 빠뜨리면 이 파일에서만
    // Number()가 조용히 허용된다.
    name: "els/db-layer-env-boundary",
    files: DB_ENV_BOUNDARY,
    rules: {
      "no-restricted-globals": ["error", ...NO_COERCION_GLOBALS],
      "no-restricted-syntax": ["error", ...NO_COERCION_SYNTAX],
    },
  },

  {
    name: "els/no-supabase-in-ui",
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/*"],
              message:
                "DB 접근은 전부 src/lib/db를 통과한다. 화면이 직접 클라이언트를 만들면 조회 계약을 우회하는 경로가 생기고, ::text 캐스팅·절단 감지·기준일 규약이 그 경로에는 적용되지 않는다.",
            },
          ],
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
