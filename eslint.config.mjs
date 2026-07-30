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

/**
 * DOC-011 §5.0 W-04 — Q-08의 **쓰기 방향** (AQ-30).
 *
 * 읽기는 `::text` 캐스팅으로 막았는데 쓰기가 열려 있으면 절대 규칙 #2가 반쪽이다.
 * 생성 타입의 `Insert`·`Update`가 금액·비율 열을 `number`로 요구하므로 **타입을
 * 그대로 따르는 코드가 곧 위반**이고, 컴파일러는 그것을 정상이라고 말한다.
 *
 * 실측(P3b 7단계): 같은 값을 문자열로 실으면 `99999999999.999999`가 그대로
 * 저장되고, JSON 수치로 실으면 `100000000000.000000`이 저장된다. 오류도 경고도
 * 없으며 `numeric(15,0)` 금액은 15자리까지 float64로 정확하므로 **값 단언으로는
 * 영원히 드러나지 않는다.** 그래서 값이 아니라 경로를 막는다.
 *
 * `InsertPayload<T>`가 타입으로 막고, 이 규칙이 **그 타입을 지나지 않는 경로**를
 * 막는다 — 원시 객체 리터럴을 바로 넘기면 생성 타입이 그대로 적용되어 `number`가
 * 통과한다. 두 번째 인자(`{ onConflict: … }`)는 대상이 아니므로 첫 인자만 본다.
 */
const NO_RAW_WRITE_PAYLOAD = [
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(insert|upsert|update)$/][arguments.0.type=/^(ObjectExpression|ArrayExpression)$/]",
    message:
      "DOC-011 §5.0 W-04 (AQ-30): 쓰기 payload를 리터럴로 넘기지 않는다. 생성 타입은 금액·비율을 number로 요구하므로 그 경로에서는 float64가 통과한다 — toInsert()/toUpdate()로 감싸 InsertPayload<T>의 검사를 받는다.",
  },
]

/**
 * ADR-003 결정성 — **셀렉터를 한 곳에서 파생시킨다.**
 *
 * 순수 모듈과 표시 모듈(`lib/format`)에 같은 세 형태를 금지하는데 사유 문장이
 * 다르다. 셀렉터를 두 벌 적으면 한쪽만 고쳐지는 날이 오고, 그때 빠지는 쪽은
 * "규칙이 있는 것처럼 보이는데 없는" 상태가 된다.
 */
function noClockSyntax({ clock, random }) {
  return [
    {
      selector: "MemberExpression[object.name='Date'][property.name='now']",
      message: clock,
    },
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: clock,
    },
    {
      selector:
        "MemberExpression[object.name='Math'][property.name='random']",
      message: random,
    },
  ]
}

/**
 * 컷 0d 규칙 3 — `src/components/**`에서 `@/lib/db/*`는 **타입만** 가져온다.
 *
 * 없으면 클라이언트 컴포넌트가 `queries/map.ts`를 값으로 끌어오고, 그것이
 * `lib/domain` 전체(판정·일정·수령액)를 브라우저 번들에 싣는다. 화면은 뷰 타입만
 * 필요하므로 `import type`으로 충분하며, 그 형태는 컴파일 후 사라진다.
 *
 * `no-restricted-imports`가 아니라 `no-restricted-syntax`인 이유: 코어 규칙에는
 * `allowTypeImports`가 없다(그 옵션은 typescript-eslint 쪽 동명 규칙에 있다).
 * 그리고 이 글롭은 `els/no-supabase-in-ui`가 이미 `no-restricted-imports`를
 * 선언한 자리이므로, 같은 이름을 다시 선언하면 **@supabase 금지가 대체되어
 * 사라진다** — 규칙 이름을 바꿔 그 충돌 자체를 없앤다.
 *
 * `import { type X }`(선언 수준 `importKind`가 `value`)도 걸린다. TS가 그런
 * 형태를 지워 주기는 하지만 지우는 조건이 컴파일러 설정에 달려 있고, 값 하나가
 * 섞이는 순간 조용히 번들에 들어온다 — 형태를 고정하는 편이 싸다.
 */
const COMPONENTS_DB_TYPE_ONLY = [
  {
    selector:
      "ImportDeclaration[importKind!='type'][source.value=/(?:^@\\/|\\/)lib\\/db(?:\\/|$)/]",
    message:
      "src/components는 lib/db를 값으로 import하지 않는다 — `import type`만 쓴다. 값 import는 queries/map.ts를 통해 lib/domain 전체를 클라이언트 번들에 싣는다. 데이터는 서버 컴포넌트가 읽어 props로 내린다.",
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
        ...noClockSyntax({
          clock:
            "ADR-003: 순수 모듈은 현재 시각에 의존할 수 없다. 기준일을 인자로 받는다.",
          random: "ADR-003: 순수 모듈은 난수를 사용할 수 없다.",
        }),
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
        ...NO_RAW_WRITE_PAYLOAD,
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

  /**
   * ★ 아래 **다섯**(P5b 컷 1에서 `lib/cron`이 늘었다)은 **파일 집합이 서로 겹치지
   * 않는다.** 플랫 설정에서 뒤에 오는 객체가 같은 이름의 규칙을 다시 선언하면 앞의
   * 설정을 병합하지 않고
   * **대체**하므로(`els/db-layer-values-and-env`의 주석과 같은 함정), 겹치면
   * 강제 변환 금지가 한쪽에서 소리 없이 사라진다. 다섯이 선언하는 규칙 이름은
   * `no-restricted-globals`·`no-restricted-syntax` 둘뿐이고, 그 둘을 앞에서
   * 선언한 글롭은 `PURE_MODULES`(lib/tax·lib/domain)와 `DB_MODULES`(lib/db)이며
   * 아래 어느 집합과도 교집합이 없다.
   *
   * 컷 0d 규칙 1 — 강제 변환 금지를 **표시 경계로 확장한다.** Q-08이 DB 경계에서
   * 막은 함정이 표시 경계에 그대로 있다: 금액 문자열을 `Number(x).toLocaleString()`
   * 으로 찍는 것이 UI에서 가장 자연스러운 실수인데, `numeric(15,0)` 금액은
   * 15자리까지 float64로 정확하므로 **값 단언으로는 영원히 드러나지 않는다.**
   */
  {
    /*
     * `_`로 시작하는 인자는 **쓰지 않겠다는 선언**이다. 서명이 프레임워크에 의해
     * 정해지는 자리에서 필요하다 — `useActionState`의 액션은 `(prev, formData)`를
     * 받아야 하고, 그 형태를 지키지 않으면 클라이언트 화살표로 감싸게 되어
     * **JS 없이 동작하지 않는 폼**이 된다(컷 1b 실측). 인자를 지울 수 없으므로
     * 이름으로 의도를 적고 린트가 그 관례를 인정하게 한다.
     *
     * `args: 'after-used'`(기본값)이라 마지막으로 쓰인 인자 **뒤**만 보고하므로
     * `(_prev, formData)`는 원래 조용하다. 둘 다 쓰지 않는 경우에만 걸린다.
     */
    name: "els/unused-underscore",
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    name: "els/app-values",
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", ...NO_COERCION_GLOBALS],
      "no-restricted-syntax": ["error", ...NO_COERCION_SYNTAX],
    },
  },

  {
    name: "els/component-boundaries",
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", ...NO_COERCION_GLOBALS],
      "no-restricted-syntax": [
        "error",
        ...NO_COERCION_SYNTAX,
        ...COMPONENTS_DB_TYPE_ONLY,
      ],
    },
  },

  {
    /*
     * 컷 0d 규칙 2 — 표시 모듈에 ADR-003 결정성.
     *
     * Q-02가 기준일을 **요청당 하나**로 고정했는데(`server.ts`의 `cache()`)
     * 포매터가 `new Date()`를 부르면 그 규약이 표시 계층에서 깨진다. D-Day 라벨과
     * 목록의 D-Day가 다른 날을 가리키는 형태이며, 자정을 걸친 렌더에서만 나타나
     * 재현되지 않는다.
     */
    name: "els/format-determinism",
    files: ["src/lib/format/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...NO_COERCION_GLOBALS],
      "no-restricted-syntax": [
        "error",
        ...NO_COERCION_SYNTAX,
        ...noClockSyntax({
          clock:
            "ADR-003 · Q-02: 포매터는 오늘을 계산하지 않는다. 기준일(asOf)을 인자로 받는다 — 요청당 한 번 해석된 값이 정본이다.",
          random: "ADR-003: 표시 계층은 난수를 사용할 수 없다.",
        }),
      ],
    },
  },

  {
    name: "els/form-values",
    files: ["src/lib/forms/**/*.ts", "src/lib/routes/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...NO_COERCION_GLOBALS],
      "no-restricted-syntax": ["error", ...NO_COERCION_SYNTAX],
    },
  },

  {
    /*
     * P5b 컷 1 — `lib/cron`이 생기는 컷에서 글롭을 함께 넣는다.
     *
     * **디렉터리를 만들고 규칙을 나중에 붙이면 그 사이가 공백이고, 공백은 위반자가 0인
     * 동안 보이지 않는다** — `src/lib/providers/**`가 세 제약 전부에서 `null`인 채로
     * 남아 있는 것이 그 상태이며(P5b 컷 7이 메운다) 그쪽은 **외부 JSON을 파싱하는 자리**라
     * 정확히 `Number(json.close)`가 쓰일 곳이다. 같은 일을 반복하지 않는다.
     *
     * 지금 `lib/cron`에 강제 변환이 필요한 코드는 없다. 규칙은 **다음 코드**를 위한 것이고
     * 그 다음 코드가 P5a의 수집 판정이다.
     */
    name: "els/cron-values",
    files: ["src/lib/cron/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...NO_COERCION_GLOBALS],
      "no-restricted-syntax": ["error", ...NO_COERCION_SYNTAX],
    },
  },

  {
    /*
     * 공급자 어댑터 — **위 주석이 예고한 빈칸을 메운다** (P5b 컷 7).
     *
     * `src/lib/providers/**`는 지금까지 `els/*` 어느 규칙에도 걸리지 않았다
     * (실측: `src/`의 137개 중 5개가 밖이었고 이것이 그중 하나다). **위반자가
     * 0인 동안 공백은 보이지 않는다** — 오늘 이 디렉터리에는 빈 레지스트리와 타입뿐이다.
     *
     * **그런데 여기가 이 저장소에서 강제 변환이 가장 자연스러운 자리다.** 어댑터는
     * 외부 JSON을 파싱하고 `fetchDailyClose`는 `DecimalValue`를 반환한다 — 그 사이에
     * `Number(json.close)`를 쓰면 **형식은 정상이고 값만 거짓**이 된다. 그리고 그 값은
     * `asset_prices`에 `source = 'AUTO'`로 저장되어 워스트오브·배리어 판정에 들어가므로
     * (ADR-004 v0.7의 스텁 각주와 같은 경로) **화면에 드러나지 않는다.**
     *
     * 규칙은 **다음 코드**를 위한 것이고 그 다음 코드가 P5a 컷 1~3의 어댑터다.
     * 디렉터리를 만들고 규칙을 나중에 붙이면 그 사이가 공백이라는 것이 위 주석의
     * 논지였고, 여기서 그 논지를 자기 자신에게 적용한다.
     *
     * 겹치지 않음: 위 다섯 + 이것 = **여섯**이며 `src/lib/providers/**`는 앞의 어느
     * 집합과도 교집합이 없다. **그 사실을 이제 사람이 세지 않는다** —
     * `tests/app/lint-coverage.test.ts`가 파일 단위로 대조한다.
     */
    name: "els/provider-values",
    files: ["src/lib/providers/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...NO_COERCION_GLOBALS],
      "no-restricted-syntax": ["error", ...NO_COERCION_SYNTAX],
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
