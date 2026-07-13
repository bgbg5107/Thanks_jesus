# CLAUDE.md — 감사 기록 앱

청년 대상 묵상 중심 감사 기록 PWA. 상세 요구사항은 `감사기록앱_기획서.docx`(PRD) 참고.
이 문서는 코드 작업 시 지켜야 할 프로젝트 규칙과 현재 구조를 요약한다.

> **중요: 작업 시작 전 반드시 `Memory.md`를 읽을 것.**
> 사용자의 개발 방향·UX 선호·반복 피드백이 정리되어 있으며, 요청에 명시되지
> 않아도 기본으로 반영해야 한다. 새로운 선호가 드러나면 Memory.md에 추가한다.

## 앱 정체성 (모든 작업의 기준)

- 컨셉: "소란한 일상 속 가장 고요한 쉼표" — 디지털 기도실 같은 톤앤매너.
- 언어적 톤: 버튼·알림·에러 문구까지 정중하고 사색적인 어조. 예: "오늘의 감사 담기",
  "연결이 닿는 대로 자동으로 저장해 드릴게요." 기술적/명령형 문구 금지.
- 시각적 톤 (2026-07 리뉴얼 — 트렌디·젊은 감성): 크림 배경 `--bg` 위에 쨍한 포인트 —
  라임 `--lime`(말씀 카드) / 라벤더 `--lav`(감사 카드) / 오렌지 `--pop`(오늘·하이라이트) /
  딥 네이비 `--brand`(주 버튼·선택 상태). 본문은 나눔명조(NanumMyeongjo,
  `public/fonts/` 자체 호스팅 ttf — 400/700/800),
  전체 명조 통일. 색은 반드시 `styles.css`의 CSS 변수만 사용
  (다크모드가 `[data-theme='dark']` 변수 재정의로 동작하므로 하드코딩 금지).
  쨍한 카드 위 글자는 테마 무관 `--accent-ink`.
  예외: 감정 캐릭터(Emo)·금향로(Censer) 등 일러스트의 고유색은 하드코딩 허용하되,
  몸 밖으로 나오는 선·기호는 다크모드 대비를 위해 `var(--ink)` 사용.
- 경험적 톤: 200~300ms의 경쾌하되 부드러운 트랜지션(`var(--t)`). 과한 바운스·현란한 모션은 금지.
- 알림창: 브라우저 기본 `alert/confirm/prompt` 금지 — `components/Dialog.jsx`의
  `appAlert / appConfirm / appPrompt`(앱 스타일 팝업)를 사용할 것.

## UI/UX 필수 원칙 (2026-07 전면 정비 — 되돌리지 말 것)

- **타이포**: 폰트 크기는 `--fs-xs(12)/sm(14)/md(16)/lg(18)/xl(22)/xxl(24)` 토큰만 사용.
  12px 미만 텍스트 금지. input·select·textarea는 16px(1rem) 이상 — iOS 포커스 확대 방지.
- **대비(WCAG AA 4.5:1)**: `--gray`·`--ink-soft`·`--alert`·`--like`·`--vis-*`는 AA를 맞춘
  값이므로 밝게 되돌리지 말 것. 쨍한 배경(`--pop` 등) 위 글자는 흰색 금지, `--accent-ink`.
- **터치 타깃**: 최소 44px(칩·작은 버튼은 40px+주변 간격). 작은 ✕ 아이콘은 시각 크기를
  유지하고 `::before { inset: -10px }` 확장 기법 사용.
- **아이콘**: 기능 아이콘(닫기·사진·하트·화살표 등)은 `components/Icon.jsx`(라인 SVG,
  stroke 1.8)만 사용 — 이모지 금지. 아이콘 전용 버튼은 `aria-label` 필수.
  단, 섹션 제목의 장식 이모지(🌿🧡💛 등)는 앱 톤이므로 유지.
- **팝업**: 배경은 반드시 `components/Overlay.jsx` 사용 — Escape 닫기·배경 스크롤
  잠금(`body.modal-open`)·`role="dialog"` 내장, 겹친 팝업은 맨 위만 Escape에 반응.
- **접근성·모션**: 클릭 요소는 `<button>`(div onClick 금지), `:focus-visible` 링 유지,
  `prefers-reduced-motion` 지원 유지, `transition: all` 금지(속성 명시).

## 기술 구성

- React 18 + Vite + vite-plugin-pwa, react-router-dom v6, 단일 CSS 파일(`src/styles.css`)
- Supabase: Auth(이메일+비밀번호) · Postgres(RLS) · Storage(`photos` 버킷, public)
- 오프라인: idb-keyval(IndexedDB) 큐 → 온라인 복귀 시 자동 동기화
- 환경 변수: `.env`의 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (없으면 안내 화면)

## 명령어

```bash
npm run dev      # 개발 서버
npm run build    # 배포 빌드 — 수정 후 반드시 통과 확인
```

## 파일 구조

```
supabase/schema.sql              # 전체 스키마+RLS+말씀 시드 (신규 설치용)
supabase/migration-*.sql         # 기존 DB에 적용하는 증분 마이그레이션
src/App.jsx                      # 전역 컨텍스트(Ctx)·라우팅·테마·동기화·리마인드
src/lib/supabase.js              # 클라이언트, configured 플래그, photoUrl()
src/lib/util.js                  # EMOTIONS(12종)·날짜·verseOfDay·streakOf
src/lib/offline.js               # 오프라인 큐(pending-entries)·flushPending·사진 업로드
src/lib/bible.js                 # 개역한글 전권 조회 — public/bible/krv.json →
                                 # IndexedDB 캐시, "요 3:16" 참조 파싱, 합쳐진 절·(없음) 처리
src/components/                  # ItemsEditor(불릿 편집)·Lightbox(사진 확대)·
                                 # Emo(감정 캐릭터 SVG)·Censer(금향로)·Dialog(앱 알림창)·
                                 # MemoCard(오늘의 메모, 하루 여러 장)·VersePicker(말씀 찾기)·
                                 # Icon(공용 라인 SVG 아이콘 — list·fontSizeUp·fontSizeDown 포함)·
                                 # Overlay(팝업 공통 배경)
src/pages/                       # Login, Home(오늘), CalendarPage(달력·통계·내보내기),
                                 # Feed(나눔), Teams(셀), Notifications, Settings, Admin,
                                 # ResetPassword(비밀번호 재설정)
```

## 핵심 아키텍처

### 인증: 아이디는 "이름"
- 가입: 실명+이메일+비밀번호. DB 트리거 `handle_new_user`가 `display_id` 자동 생성 —
  첫 가입자는 이름 그대로, 동명이인 발생 시 기존자 `이름A`, 신규 `이름B`, `이름C`…
- 로그인: 아이디(이름) 입력 → RPC `email_for_login(display_id)`로 이메일 변환 →
  `signInWithPassword`. 이메일은 비밀번호 재설정용으로만 노출.
- 비밀번호 찾기: 이름+이메일을 함께 받아 가입 이메일과 일치할 때만 재설정 링크 발송
  (동명이인 오발송 방지).
- 비밀번호는 Supabase `auth.users`에 bcrypt 해시로만 저장. profiles에 두지 말 것.
- 정지 계정(`profiles.status='suspended'`)은 App.jsx의 loadProfile에서 강제 로그아웃.

### 전역 컨텍스트 (`useApp()` — App.jsx의 Ctx)
`{ session, profile, reloadProfile, theme, setTheme, online, unread, loadUnread, teams, loadTeams, feedNew, markFeedSeen }`
- 팀 목록은 컨텍스트의 `teams`/`loadTeams`가 유일한 소스. 페이지에서 중복 조회하지 말 것.
- 알림 배지(unread)는 60초 폴링. 알림 읽음 처리 후 `loadUnread()` 호출 필요.

### 기록(Entry) 규칙
- 하루 1건: DB `unique(user_id, date)` + 저장은 항상 `upsert(onConflict:'user_id,date')`.
- `contents`(jsonb)는 항목 배열 — 옛 형식(문자열)과 새 형식(`{text, photos}`)이 혼재.
  읽을 때는 util.js의 `itemText()/itemPhotos()`로 감싸서 접근할 것.
- 감정은 `EMOTIONS` 12종의 name 문자열 그대로 저장. 목록 수정 시 util.js만 변경.
  화면 표시는 `Emo` 캐릭터 SVG, 텍스트 내보내기에만 이모지(`emojiOf`) 사용.
- 내용을 모두 지우면(사진 포함) 기록 자체를 조용히 삭제 — 별도 버튼·확인 없이
  자동 저장과 같은 3초 호흡 (홈·달력 동일).
- 공유: `visibility` = private | team | users. team이면 `shared_team_ids[]`(여러 개),
  users면 `shared_user_ids[]` 사용. 기본값은 반드시 private.
  화면의 공유 카테고리는 4종(나만/셀/나눔 공동체/개인)이지만 DB는 'team' 하나로 통합.

### 메모(Memo) 서식
- 본문은 contentEditable(`memo-body`) — sanitizer가 허용하는 태그:
  `B/STRONG/I/EM/U/BR/DIV/P/SPAN/BLOCKQUOTE/FONT/MARK/UL/OL/LI` + vq 클래스.
- `FONT` 태그의 `size` 속성은 sanitize 시 보존(글자 크기 유지).
- 툴바 기능: 굵게 · 글자 크기 조절(A−/A+, execCommand fontSize 2-6) ·
  글머리 기호(insertUnorderedList) · 인용 · 말씀 담기 · 서식 지우기 · 형광펜 4색 · 사진.
- 툴바(`memo-tools`)는 버튼이 많으므로 가로 스크롤 허용(scrollbar 숨김).

### 감사 카드 레이아웃
- `gratitude-card`는 `justify-content: flex-start` — 텍스트·사진 모두 상단 정렬.
  사진 영역(`gc-photos`)은 `margin-top: auto`로 하단 배치.

### 오프라인 흐름
저장 실패/오프라인 → `savePending()`(사진은 Blob으로 보관) → `online` 이벤트 또는 앱
시작 시 `flushPending()` → 성공 시 `synced` CustomEvent 발행(Home이 수신해 재로드).
달력은 서버 데이터에 pending을 병합해 표시(`pending: true` 플래그).

### 권한은 RLS가 담당
- 피드/공유 노출, 차단(양방향 숨김), 팀 멤버십, 관리자 권한은 전부 `schema.sql`의
  RLS 정책이 강제한다. 클라이언트 필터는 UX 보조일 뿐 보안 로직을 JS에 두지 말 것.
- 관리자: `profiles.is_admin` 플래그(SQL로 수동 지정). PRD의 고정 ID/PW(intouch/8291)는
  PRD 자체의 보안 권고에 따라 채택하지 않음 — 재도입 금지.
- 관리자 계정 UI: 하단 탭 없이 로그인 즉시 `/admin`으로 이동, 로그아웃은 관리자
  페이지 상단. 셀 현황 RPC(`admin_team_stats`)는 셀만 집계 — 나눔 공동체는
  프라이버시상 관리자에게도 비노출(서버에서 제외, 클라이언트 필터는 보조).
- 스키마 변경 시: `schema.sql`(신규 설치)과 새 `migration-N-*.sql`(기존 DB) 둘 다 작성.

### 말씀(Verse)
- 외부 API 없이 자체 DB 시드 50구절(개역개정) 사용 — PRD의 개발 참고 권고안.
- 홈 상단: `verseOfDay()`가 날짜 해시로 결정(자정 기준 자동 갱신).
  저장 완료 팝업(하루 첫 담기): `randomVerse()` + 금향로(`Censer`) 연출 —
  전체 누적 기록 수만큼 하트가 쌓이고 새 하트가 떨어진다.
  구절은 localStorage에 캐시되어 오프라인 표시 가능.
- 메모의 '말씀 담기'는 별도로 **개역한글 전권**(`public/bible/krv.json`, 저작권 만료 역본)을
  사용 — `lib/bible.js` 참조. 개역개정 전권은 대한성서공회 저작권 때문에 탑재 금지.

## 데이터 모델 요약 (상세는 schema.sql)

profiles(display_id·email·status·is_admin·reminder_time) · entries(위 참조) ·
memos(id PK, user_id+date 인덱스 — 하루 여러 장, 본인만) ·
teams(leader_id=생성자=팀장) · team_members(status: invited/accepted/rejected/removed) ·
likes · reports(status: open/warned/suspended/deleted/dismissed) · blocks ·
notifications(type: team_invite/like/report/admin/nudge/cell_week, payload jsonb) · verses

## 알려진 제약 (버그 아님)

- 리마인드·알림은 인앱 + 브라우저 Notification(탭이 열려 있을 때만).
  백그라운드 푸시(FCM)는 미구현 확장 항목.
- PDF 내보내기는 인쇄 뷰(`@media print` + `.print-only`) 방식.
- 팀 초대 수신은 알림 탭에서 수락/거절(60초 폴링, 실시간 아님).

## UI/UX 스킬 자동 적용 규칙

UI·UX 관련 작업 시 아래 스킬을 **자동으로** 읽고 적용할 것.
사용자가 명시적으로 호출하지 않아도, 작업 내용이 트리거 조건에 해당하면 반드시 참조한다.

| 스킬 | 파일 | 자동 트리거 조건 |
|------|------|-----------------|
| **ui-ux-pro-max** | `.claude/skills/ui-ux-pro-max.md` | 컴포넌트·페이지를 **새로 만들거나 리팩터링**할 때, 색상·타이포·스타일·레이아웃·애니메이션을 결정할 때, 접근성·반응형·다크모드를 점검할 때. 검색이 필요하면 `python3 .claude/skills/ui-ux-pro-max/scripts/search.py` 사용. |
| **frontend-design** | `.claude/skills/frontend-design.md` | UI 코드를 **작성·수정**할 때 — JSX/CSS 변경이 화면에 보이는 요소(버튼, 카드, 모달, 폼, 레이아웃 등)에 영향을 줄 때마다 적용. 제네릭한 AI 미학을 피하고 앱 정체성에 맞는 디자인 품질을 유지. |
| **web-design-guidelines** | `.claude/skills/web-design-guidelines.md` | UI를 **리뷰·점검**할 때 — "리뷰해줘", "접근성 확인", "UX 감사", "디자인 체크" 등 품질 검증 요청 시. |

### 적용 우선순위
1. **CLAUDE.md의 앱 정체성**(톤·색상·폰트 규칙)이 항상 최우선 — 스킬 가이드와 충돌 시 CLAUDE.md를 따른다.
2. 스킬 내 권장사항은 앱 정체성에 어긋나지 않는 범위에서 적용한다.
3. 여러 스킬이 동시에 해당되면 모두 참조한다(예: 새 페이지 작성 = ui-ux-pro-max + frontend-design).

## 작업 수칙

- 문구 하나를 추가해도 "앱 정체성" 섹션의 톤을 따를 것.
- 기능 추가 전 PRD 범위 확인 — 요청받지 않은 기능·추상화 금지.
- 수정 후 `npm run build` 통과 확인. DB를 건드리면 마이그레이션 파일 동반.
- 사용자 노출 경로/파일명에 내부 구현 용어 노출 금지.
