# 환경 및 브랜치 운영

| 환경 | 브랜치 | 사용자 앱 | 관리자 앱 | Supabase |
|---|---|---|---|---|
| 개발 | `develop` | `develop.haligali.swonport.kr` | `develop.admin.haligali.swonport.kr` | 별도 개발 프로젝트 |
| 운영 | `main` | `haligali.swonport.kr` | `admin.haligali.swonport.kr` | 별도 운영 프로젝트 |

## 환경 파일

- 로컬 개발: `.env.development`
- 로컬 운영 빌드 확인: `.env.production`
- Git에는 실제 키를 커밋하지 않고 `.env.*.example`만 보관한다.
- Cloudflare Pages에는 각 프로젝트/환경별로 동일한 변수 이름과 서로 다른 값을 설정한다.
- `SUPABASE_SERVICE_ROLE_KEY`, VAPID private key는 Vite 변수로 설정하지 않는다.
- `VITE_PHONE_AUTH_ENABLED`는 해당 Supabase 프로젝트에서 Phone Provider와 SMS 공급자가 모두 활성화된 경우에만 `true`로 설정한다.
- `npm run keys:vapid`는 개발/운영 VAPID 키와 일회성 관리자 부트스트랩 비밀값을 생성한다.
- 공개키는 `.env.development`/`.env.production`, 비밀키는 `supabase/.env.*.local`에 기록되며 실제 파일은 모두 Git에서 제외된다.
- Supabase 배포 시 `supabase secrets set --env-file supabase/.env.<environment>.local`로 해당 프로젝트에 비밀값을 등록한다.

## 배포 흐름

1. 기능 브랜치는 `develop`에서 분기한다.
2. PR을 `develop`에 병합하면 개발 도메인으로 배포한다.
3. 검증된 `develop`을 `main`으로 PR 병합한다.
4. `main`은 운영 도메인과 운영 Supabase만 사용한다.
5. DB 마이그레이션은 개발 Supabase에서 검증한 뒤 같은 파일을 운영에 적용한다.

## 변수 목록

| 위치 | 변수 | 공개 여부 | 용도 |
|---|---|---|---|
| `.env.<environment>` | `VITE_APP_ENV` | 공개 | 개발/운영 UI 구분 |
| `.env.<environment>` | `VITE_PUBLIC_APP_URL` | 공개 | 사용자 앱 기준 URL |
| `.env.<environment>` | `VITE_ADMIN_APP_URL` | 공개 | 관리자 앱 URL |
| `.env.<environment>` | `VITE_SUPABASE_URL` | 공개 | 환경별 Supabase URL |
| `.env.<environment>` | `VITE_SUPABASE_ANON_KEY` | 공개 | RLS가 적용되는 anon key |
| `.env.<environment>` | `VITE_VAPID_PUBLIC_KEY` | 공개 | 브라우저 Push 구독 공개키 |
| `.env.<environment>` | `VITE_PHONE_AUTH_ENABLED` | 공개 | 실제 지원되는 환경에서만 전화 인증 노출 |
| `supabase/.env.<environment>.local` | `ALLOWED_ORIGINS` | 비공개 설정 | Edge Function CORS 허용 목록 |
| `supabase/.env.<environment>.local` | `VAPID_PRIVATE_KEY` | 비밀 | Push 서명 키 |
| `supabase/.env.<environment>.local` | `VAPID_SUBJECT` | 비공개 설정 | Push 운영자 연락처 |
| `supabase/.env.<environment>.local` | `BOOTSTRAP_SECRET` | 비밀 | 최초 관리자 일회성 생성 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 배포된 Edge Function 런타임에서 제공된다. service role 키를 `VITE_` 변수나 Cloudflare 클라이언트 빌드 변수에 복사하지 않는다.

전체 공개 전 절차와 실기기 검증은 `docs/release-candidate.md`를 따른다.

## 관리자 권한

관리자 UI 노출 여부와 관계없이 모든 관리 작업은 DB RLS 또는 service-role Edge Function에서 다시 검증한다. 사용자 탈퇴·정지, 방 강제 종료, 스페이스 정지는 `moderation_actions`에 감사 기록을 남긴다.
