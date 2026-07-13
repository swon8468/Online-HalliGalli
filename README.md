# Halli Galli Online

React, TypeScript, Vite, Supabase로 구성한 실시간 카드 게임 PWA입니다. 일반 사용자 앱, 관리자 화면, 스페이스별 커스텀 카드 및 봇 연습 모드를 포함합니다.

## 로컬 실행

```bash
npm install
cp .env.development.example .env.development.local
npm run dev
```

Supabase 키가 없어도 개발용 데모 인증과 UI는 동작합니다. 실제 기능을 연결하려면 `.env.development.local`에 개발 Supabase URL과 anon key를 입력하고 `supabase/migrations`의 SQL을 적용하세요.

## 명령어

- `npm run dev`: 개발 서버
- `npm run dev:prod`: 로컬에서 운영 모드 확인
- `npm run build:develop`: 개발 환경 빌드
- `npm run build`: 타입 검사 및 프로덕션 빌드
- `npm run lint`: ESLint 검사
- `npm run preview`: 빌드 결과 미리보기

## 배포

세부 환경 및 브랜치 전략은 `docs/environments.md`를 참고하세요. Cloudflare Pages의 출력 디렉터리는 `dist`입니다. service role 키와 VAPID private key는 브라우저 환경 변수에 넣지 않습니다.
