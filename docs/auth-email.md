# 인증 메일 설정

Halli Galli의 회원가입 확인과 비밀번호 재설정 메일은 Supabase Auth가 보내고, 실제 SMTP 전송은 Resend가 담당합니다. API 키와 SMTP 비밀번호는 브라우저에서 사용하는 `VITE_` 환경변수나 저장소에 넣지 않습니다.

## 1. Resend 발신 도메인

1. Resend에서 `swonport.kr` 도메인을 추가합니다.
2. 안내되는 SPF와 DKIM 레코드를 Cloudflare DNS에 추가합니다.
3. Resend에서 도메인이 `Verified`로 표시될 때까지 기다립니다.
4. 링크 변형으로 Supabase 인증 링크가 깨지지 않도록 Resend의 클릭/오픈 추적 기능은 끕니다.
5. 발신 주소는 `no-reply@swonport.kr`, 발신 이름은 `Halli Galli`를 권장합니다.

## 2. 개발 Supabase SMTP

Supabase Dashboard의 Authentication → Email/SMTP 설정에서 Custom SMTP를 활성화합니다.

| 항목 | 값 |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | Resend에서 만든 API 키 |
| Sender email | `no-reply@swonport.kr` |
| Sender name | `Halli Galli` |

Resend API 키는 Supabase Dashboard에만 입력합니다. 로컬 `.env`, GitHub, Vite 클라이언트 코드에는 복사하지 않습니다.

운영 프로젝트에 스크립트로 같은 공개 SMTP 설정을 적용할 때는 관리 API가 반환한 `smtp_pass`를 재사용하지 않습니다. 이 값은 프로젝트별로 보호된 값이라 다른 프로젝트의 실제 SMTP 비밀번호가 아닙니다. 실제 Resend API 키는 명령 한 번에만 환경변수로 전달합니다.

```sh
AUTH_SMTP_PASSWORD='실제 Resend API 키' \
AUTH_CONFIG_APPLY_CONFIRMATION=production:PROJECT_REF \
npm run auth-config:apply:production
```

터미널 기록을 남기지 않으려면 Supabase Dashboard의 Authentication → Email/SMTP에서 운영 프로젝트에 직접 입력하는 방식을 사용합니다. 적용 직후에는 설정 감사만으로 끝내지 말고 외부 주소로 실제 가입 메일을 보내 SMTP 인증까지 확인합니다.

## 3. URL 설정

개발 프로젝트의 Site URL은 `https://develop.haligali.swonport.kr`, 운영 프로젝트는 `https://haligali.swonport.kr`로 설정합니다. Redirect URLs에는 각각 다음 경로를 허용합니다.

- 개발: `https://develop.haligali.swonport.kr/recover?type=recovery`
- 운영: `https://haligali.swonport.kr/recover?type=recovery`
- 로컬 개발이 필요할 때만 현재 로컬 포트의 `/recover?type=recovery`

와일드카드 URL을 허용할 수 있지만 운영에서는 필요한 도메인과 경로만 허용하는 편이 안전합니다.

## 4. 한글 템플릿 확인과 적용

먼저 로컬 템플릿과 원격 상태를 비교합니다. 미리보기는 원격 설정을 변경하지 않습니다.

```sh
npm run test-auth-email-templates
npm run auth-templates:preview:develop
```

개발 프로젝트에만 적용할 때 프로젝트 ref를 미리보기 결과에서 확인하고 다음처럼 일회성 확인값을 지정합니다.

```sh
AUTH_TEMPLATE_APPLY_CONFIRMATION=development:PROJECT_REF npm run auth-templates:apply:develop
```

이 명령은 메일 제목과 본문만 변경하며 SMTP 비밀번호나 다른 Auth 설정은 수정하지 않습니다. 운영 적용은 배포 승인 후 별도로 진행합니다.

## 5. 실제 메일 스모크 테스트

1. 개발 사이트에서 테스트 이메일로 회원가입합니다.
2. 한글 가입 확인 메일이 도착하는지, 스팸함으로 분류되지 않는지 확인합니다.
3. 인증 버튼이 개발 사이트로 이동하고 로그인 가능한지 확인합니다.
4. 비밀번호 찾기를 한 번 요청하고 별도 전송 완료 화면으로 이동하는지 확인합니다.
5. 재설정 링크로 새 비밀번호를 저장한 뒤 새 비밀번호로 로그인합니다.
6. 같은 주소로 빠르게 반복 요청했을 때 앱의 중복 방지와 Supabase 전송 제한 안내가 작동하는지 확인합니다.
7. 만료된 링크와 이미 사용한 링크가 한글 오류 화면으로 연결되는지 확인합니다.

운영 SMTP 자격증명과 가입 트리거를 함께 확인하려면 수신 가능한 테스트 주소로 공개 가입 스모크 테스트를 실행합니다. 생성된 임시 사용자는 성공·실패와 관계없이 정리됩니다.

```sh
AUTH_SIGNUP_SMOKE_CONFIRMATION=production:test@example.com \
npm run auth-signup:smoke -- production test@example.com
```

## 6. 설정 점검

```sh
npm run audit-auth:develop
```

점검 결과에는 비밀값 대신 설정 여부만 출력됩니다. `custom_smtp`, `smtp_sender_domain`, `redirect_allowlist`, `email_rate_limit`, `branded_email_templates`를 확인합니다.
