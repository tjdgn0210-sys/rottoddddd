export type AuthMode = 'signIn' | 'signUp';

export function validateAuthInput(mode: AuthMode, email: string, password: string, confirmation: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return '올바른 이메일 주소를 입력하세요.';
  if (!password) return '비밀번호를 입력하세요.';
  if (mode === 'signUp' && password !== confirmation) return '비밀번호 확인이 일치하지 않습니다.';
  return null;
}

/** Only safe, actionable messages reach screens; never expose SQL or stack traces. */
export function getAuthErrorMessage(error: unknown): string {
  const value = error as { code?: string; status?: number; name?: string; message?: string } | null;
  switch (value?.code) {
    case 'invalid_credentials': return '이메일 또는 비밀번호가 올바르지 않습니다.';
    case 'email_not_confirmed': return '이메일에서 계정을 확인한 뒤 로그인하세요.';
    case 'user_already_exists': case 'email_exists': return '이미 가입된 이메일입니다. 로그인해 주세요.';
    case 'email_address_invalid': case 'validation_failed': return '이메일 주소와 입력 내용을 확인하세요.';
    case 'weak_password': return '비밀번호가 보안 기준에 맞지 않습니다. 더 긴 비밀번호를 사용하세요.';
    case 'over_email_send_rate_limit': case 'over_request_rate_limit': return '요청이 많습니다. 잠시 후 다시 시도하세요.';
    case 'signup_disabled': return '현재 회원가입을 사용할 수 없습니다.';
    case 'session_not_found': case 'refresh_token_not_found': case 'refresh_token_already_used': return '로그인이 만료되었습니다. 다시 로그인하세요.';
  }
  if (value?.status === 429) return '요청이 많습니다. 잠시 후 다시 시도하세요.';
  if (value?.name === 'AuthRetryableFetchError' || /network|fetch|offline/i.test(value?.message ?? '')) {
    return '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.';
  }
  return '요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.';
}
