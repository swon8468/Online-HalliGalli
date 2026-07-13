# 릴리스 후보 검증 가이드

이 문서는 개발 검증과 실제 기기 검증을 분리한다. 자동화가 통과해도 `실기기 필요` 항목이 비어 있으면 공개 준비 완료로 판단하지 않는다.

## 현재 확인된 환경 상태

| 항목 | 개발 환경 상태 | 공개 전 조치 |
|---|---|---|
| Auth Site URL | `https://develop.haligali.swonport.kr` | 운영 프로젝트는 `https://haligali.swonport.kr`로 별도 설정 |
| 개발 Redirect URL | 개발 도메인과 로컬 43127/43129 허용 | 운영은 `https://haligali.swonport.kr/recover**`처럼 필요한 경로만 허용 |
| 이메일 로그인 | 활성 | 운영 SMTP와 발신 도메인 검증 필요 |
| 커스텀 SMTP | 개발 프로젝트 미설정 | 공개 전 개발·운영 각각 설정하고 실제 수신 확인 |
| 비밀번호 정책 | 개발 서버 최소 8자, UI 최소 8자 | 운영도 최소 8자 이상으로 맞추고 Pro 이상이면 HIBP 유출 비밀번호 차단 활성화 |
| 전화번호 인증 | 개발 프로젝트 비활성 | SMS 공급자를 설정한 환경에서만 `VITE_PHONE_AUTH_ENABLED=true` 사용 |
| 푸시 등록 | 인증 전용 RPC와 여러 기기 endpoint 저장 | HTTPS 개발 도메인과 실기기에서 수신 확인 |
| PWA 아이콘 | 192/512 PNG, maskable, iOS 180 PNG | 기기 홈 화면에서 잘림 여부 확인 |
| Cloudflare 딥링크 | `public/_redirects`가 모든 경로를 `index.html`로 200 fallback | 배포 후 `/recover`, `/admin`, `/room/...` 직접 진입 확인 |

Supabase 기본 메일러는 프로젝트 팀에 등록된 주소에만 전달되고 전송 한도가 매우 낮으므로 공개용으로 사용하지 않는다. 재설정 API가 성공을 반환해도 실제 수신 가능성을 의미하지 않는다.

## 자동 검증

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build:develop
npm run test-pwa
npm run build
```

개발 Supabase 비밀값이 준비된 환경에서는 다음을 추가한다. 연결형 E2E, 부하 테스트, 전체 통합 테스트가 만드는 계정·방·스페이스·카드 세트는 성공/실패와 관계없이 종료 단계에서 자동 삭제되고 잔존 여부도 검사한다. 정리 도구는 개발 환경과 exact 이메일 allowlist만 허용하며 외부 사용자가 연결된 리소스는 삭제하지 않고 중단한다.

```bash
npm run test:integration
npm run test:e2e:connected
npm run test-release-load
npm run test-fixtures:preview
```

자동화 범위:

- 데스크톱/Pixel 5 화면의 핵심 메뉴, 인증 보호 경로, 가입 검증, 봇 카드 뒤집기, 만료 복구 링크, 404
- 실제 개발 Supabase에서 두 계정 로그인, 방 생성, 코드 참여, 준비, 시작, 동일 게임 진입
- 6인 병렬 참여/준비, 동일 액션 12회 멱등 처리, 경쟁 턴 6건 단일 승인 및 응답 시간 측정
- PWA 매니페스트, 설치 아이콘 크기, 캐시 워커, 업데이트/오프라인 훅, 푸시 payload 복구, 동일 출처 딥링크
- 푸시 endpoint의 인증 등록, 공유 기기 계정 변경, RLS 소유권, 테스트 데이터 삭제

## 실제 기기 필요

| 기기/상태 | 확인 시나리오 | 통과 기준 |
|---|---|---|
| iPhone/iPad Safari | 공유 → 홈 화면에 추가 | 아이콘이 잘리지 않고 standalone으로 열림 |
| iOS 설치 앱 | 알림 허용 후 앱 종료 상태 초대 | 시스템 알림 수신, 탭 시 해당 초대 URL로 이동 |
| Android Chrome | 설치 배너/홈 화면 설치 | standalone 실행, 뒤로가기와 safe-area 정상 |
| Android 설치 앱 | 전경/배경/종료 상태 초대 | 중복 없이 수신하고 초대 화면으로 이동 |
| 같은 계정 여러 기기 | 두 기기 모두 알림 허용 | 두 구독 모두 유지되고 둘 다 수신 |
| 같은 기기 계정 변경 | A 로그아웃 후 B에서 알림 켜기 | endpoint 충돌 없이 B 소유로 등록 |
| 권한 거절/해제 | 브라우저 설정에서 권한 차단 | 한글 안내, 반복 권한 팝업 없음 |
| 오프라인/복구 | 게임 중 네트워크 끊기/복구 | 오프라인 입력 차단, 복구 후 서버 상태로 재동기화 |
| 서비스 워커 업데이트 | 구버전 설치 후 새 빌드 제공 | 업데이트 배너 표시, 사용자 승인 후 새 버전 로드 |

실기기 결과에는 기기, OS, 브라우저 버전, 시각, 계정, 성공/실패, 스크린샷을 기록한다. 실제 Push Subscription과 테스트 초대는 검증 후 삭제한다.

## 인증 이메일과 SMS

SMTP 설정값은 코드나 `.env.*`가 아니라 각 Supabase 프로젝트의 Authentication SMTP 설정에 입력한다.

- SMTP host, port, user, password
- From 주소와 sender name
- 인증 전용 발신 서브도메인의 SPF, DKIM, DMARC
- 링크 추적 비활성화
- 회원가입 확인/비밀번호 재설정 템플릿의 `RedirectTo` 사용 확인
- 이메일 전송 rate limit과 행사 예상 트래픽 확인

검증 순서:

1. 개발 SMTP에서 프로젝트 팀 외부 주소로 가입 확인 메일을 수신한다.
2. 비밀번호 재설정 요청 후 `/recover?type=recovery`로 이동하는지 확인한다.
3. 새 비밀번호 저장 후 기존 세션이 종료되고 새 비밀번호로 로그인되는지 확인한다.
4. 이미 사용한 링크와 만료 링크가 한글 오류 화면으로 이동하는지 확인한다.
5. 60초 내 중복 요청, 시간당 제한, 존재하지 않는 계정 응답이 계정 존재 여부를 노출하지 않는지 확인한다.

전화번호 기능은 Supabase Phone Provider와 SMS 공급자가 실제 활성화된 뒤에만 노출한다. 공급자가 비활성인 현재 개발 환경에서는 `VITE_PHONE_AUTH_ENABLED=false`가 정상 상태다.

## 데이터 정리 정책

`get_release_maintenance_preview()`는 실제 삭제 없이 다음 대상을 집계한다. `run_release_maintenance(false, null)`도 항상 dry-run이다.

- 자동 정리 가능: heartbeat가 만료된 매칭 대기열, 완료된 매칭 행, 만료된 초대, 오래된 식별자 rate-limit 행
- 수동 검토 전용: 180일 이상 된 푸시 구독, 90일 이상 된 종료 게임·방, soft-delete 프로필, 참조되지 않는 카드 Storage 파일

실제 실행은 관리자 권한과 정확한 `RELEASE_MAINTENANCE` 확인 문구가 모두 필요하다. 종료 게임·방, 프로필, 푸시 구독, 카드 파일은 이 RPC가 자동 삭제하지 않는다. 카드 파일은 DB 경로만 지우지 말고 Storage API로 대상과 참조 여부를 다시 확인한다.

최신 개발 dry-run에서는 자동 정리 대상, 참조되지 않는 카드 파일, soft-delete 프로필이 모두 0건이다. 기존 자동 테스트 파일 7개는 `test-숫자.png` exact 패턴과 삭제된 카드 세트 폴더임을 확인한 뒤 Storage API로 정리했다. 일반 사용자 파일은 삭제하지 않았다.

카드 세트 삭제는 `delete-card-set` Edge Function이 사용자 권한과 사용 중 여부를 서버에서 확인한 뒤 DB와 Storage를 순서대로 정리한다. Storage 삭제 후 실제 목록을 재확인하고, 완료되지 않으면 성공으로 숨기지 않고 진단 ID와 정리 대기 상태를 반환한다.

## 운영 관측 선택지

외부 SDK는 아직 추가하지 않았다. 공개 전 개인정보 처리 범위와 월 예산을 정한 뒤 하나를 선택한다.

| 선택지 | 적합한 용도 | 2026-07 확인 비용 | 주의점 |
|---|---|---|---|
| Supabase 기본 로그 | Auth, DB, Realtime, Edge Function 서버 진단 | Free 1일 보존, Pro 월 $25부터·7일 보존 | 브라우저 예외와 사용자 세션 재현은 제한적 |
| Sentry | React 오류, source map, tracing, release health | Developer $0(1인·월 5천 오류), Team 연간 결제 기준 월 $26부터 | DSN/SDK 추가 전에 PII 필터와 샘플링 정책 필요 |
| Cloudflare Web Analytics | 페이지 방문과 Web Vitals의 가벼운 추세 | Free 플랜 $0, proxied 사이트 수 제한 없음 | 오류 stack과 게임 action 진단 도구는 아님 |
| Supabase Log Drain | 장기 보존 및 외부 SIEM/로그 도구 연결 | Pro 이상, drain당 월 $60 + 이벤트/egress 사용료 | 초기 소규모 운영에는 과할 수 있음 |

현재 권장 순서는 Supabase 기본 로그와 앱의 오류 ID로 시작하고, 실제 공개 후 브라우저 오류 재현이 부족하면 Sentry Developer를 검토하는 것이다. 비용은 변경될 수 있으므로 도입 직전에 각 공식 가격표를 다시 확인한다.

가격 근거: [Supabase Pricing](https://supabase.com/pricing), [Sentry Pricing](https://sentry.io/pricing/), [Cloudflare Plans](https://www.cloudflare.com/plans/), [Cloudflare Web Analytics limits](https://developers.cloudflare.com/web-analytics/limits/).

## 배포 전 체크리스트

- [ ] 개발 Supabase 마이그레이션, DB lint, 통합 테스트 통과
- [ ] 운영 DB 백업/복구 지점 확인
- [ ] 운영 Supabase에 마이그레이션을 파일 순서대로 적용
- [ ] 운영 Edge Function 비밀값과 허용 Origin 확인 후 함수 배포
- [ ] 운영 Auth Site URL, Redirect URL, SMTP, rate limit, 최소 비밀번호 8자 이상 확인
- [ ] Pro 이상 플랜이면 Auth의 HIBP 유출 비밀번호 차단 활성화
- [ ] Cloudflare 사용자/관리자 프로젝트에 각 운영 공개 변수 설정
- [ ] `main` 빌드와 스모크 테스트 통과
- [ ] 실제 기기 PWA/푸시 표 완료
- [ ] 최초 관리자 bootstrap 완료 후 비밀값 회전 또는 기능 접근 차단 확인

## 배포 후 스모크 테스트

1. 사용자/관리자 도메인과 임의 딥링크를 직접 새로 연다.
2. 새 사용자 가입 확인 메일과 기존 사용자 비밀번호 재설정을 각각 1회 수행한다.
3. 두 계정으로 방 생성 → 링크 참여 → 준비 → 게임 시작 → 종 판정 → 결과를 확인한다.
4. 친구 요청 → 초대 → 백그라운드 푸시 → 딥링크를 확인한다.
5. 일반 사용자의 관리자 접근과 다른 스페이스 데이터 접근이 차단되는지 확인한다.
6. 카드 세트 게시 → 방 적용 → 게임 스냅샷 버전 보존을 확인한다.
7. Supabase Auth/Realtime/Edge Function 로그에서 새로운 오류와 비밀값 노출이 없는지 확인한다.

## 롤백과 장애 확인 순서

- 프런트엔드: Cloudflare의 직전 성공 배포로 되돌린다.
- Edge Function: 직전 검증 커밋의 함수를 다시 배포한다.
- DB: 사용자 데이터가 있는 마이그레이션을 임의로 down 하지 않는다. 호환 가능한 forward-fix를 우선하고, 데이터 손상 시 검증된 백업 복구 절차를 사용한다.
- 장애 확인: 브라우저 오류 ID → 방/게임/action ID → Edge Function 로그 → Auth/Realtime 로그 → DB 감사 로그 순서로 추적한다.
- 인증 메일 장애: Auth 로그 → SMTP 공급자 수락/반송 로그 → DNS(SPF/DKIM/DMARC) → rate limit → 템플릿 링크 추적 순서로 확인한다.

## Supabase 적용 순서

1. 운영 백업과 현재 migration 버전을 확인한다.
2. `npx supabase db push --linked --include-all`로 번호 순서의 migration을 적용한다.
3. `ALLOWED_ORIGINS`, VAPID, bootstrap 비밀값을 운영 프로젝트 secrets에 설정한다.
4. `bootstrap-super-admin`, `send-push`, `admin-actions`, `check-identifier`, `delete-account`, `space-admin`, `delete-card-set` 순서로 Edge Function을 배포한다.
5. `npx supabase db lint --linked --level warning`과 배포 후 스모크 테스트를 실행한다.

자동 스크립트는 `npm run supabase:deploy:production`이지만 운영 변경이므로 백업·환경값·대상 project ref를 사람이 확인한 뒤에만 실행한다.
