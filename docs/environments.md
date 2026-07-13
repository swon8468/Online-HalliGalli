# 환경 및 브랜치 운영

| 환경 | 브랜치 | 사용자 앱 | 관리자 앱 | Supabase |
|---|---|---|---|---|
| 개발 | `develop` | `develop.haligali.swonport.kr` | `develop.admin.haligali.swonport.kr` | 별도 개발 프로젝트 |
| 운영 | `main` | `haligali.swonport.kr` | `admin.haligali.swonport.kr` | 별도 운영 프로젝트 |

## 환경 파일

- 로컬 개발: `.env.development.local`
- 로컬 운영 빌드 확인: `.env.production.local`
- Git에는 실제 키를 커밋하지 않고 `.env.*.example`만 보관한다.
- Cloudflare Pages에는 각 프로젝트/환경별로 동일한 변수 이름과 서로 다른 값을 설정한다.
- `SUPABASE_SERVICE_ROLE_KEY`, VAPID private key는 Vite 변수로 설정하지 않는다.

## 배포 흐름

1. 기능 브랜치는 `develop`에서 분기한다.
2. PR을 `develop`에 병합하면 개발 도메인으로 배포한다.
3. 검증된 `develop`을 `main`으로 PR 병합한다.
4. `main`은 운영 도메인과 운영 Supabase만 사용한다.
5. DB 마이그레이션은 개발 Supabase에서 검증한 뒤 같은 파일을 운영에 적용한다.

## 관리자 권한

관리자 UI 노출 여부와 관계없이 모든 관리 작업은 DB RLS 또는 service-role Edge Function에서 다시 검증한다. 사용자 탈퇴·정지, 방 강제 종료, 스페이스 정지는 `moderation_actions`에 감사 기록을 남긴다.
