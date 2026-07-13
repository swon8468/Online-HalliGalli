export function translateAuthError(error: unknown, fallback = '계정 정보를 확인해 주세요.') {
  const message = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error ?? '')
  const normalized = message.toLowerCase()

  if (normalized.includes('invalid login credentials')) return '이메일 또는 비밀번호가 일치하지 않아요.'
  if (normalized.includes('email not confirmed')) return '이메일 인증을 완료한 뒤 로그인해 주세요.'
  if (normalized.includes('user is banned')) return '정지된 계정이에요. 관리자에게 문의해 주세요.'
  if (normalized.includes('account_suspended')) return `정지된 계정이에요.${message.split(':')[1] ? ` 사유: ${message.split(':').slice(1).join(':')}` : ' 관리자에게 문의해 주세요.'}`
  if (normalized.includes('account_deleted')) return '탈퇴 처리된 계정이라 로그인할 수 없어요.'
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'
  if (normalized.includes('email address not authorized')) return '현재 이 이메일로 인증 메일을 보낼 수 없어요. 관리자에게 문의해 주세요.'
  if (normalized.includes('unsupported phone provider') || normalized.includes('phone provider is disabled')) return '현재 전화번호 인증을 사용할 수 없어요.'
  if (normalized.includes('password should be')) return '비밀번호 조건을 다시 확인해 주세요.'
  if (normalized.includes('user already registered')) return '이미 가입된 계정이에요.'
  if (normalized.includes('signup is disabled')) return '현재 회원가입을 이용할 수 없어요.'
  if (normalized.includes('network') || normalized.includes('fetch')) return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
  return message || fallback
}
