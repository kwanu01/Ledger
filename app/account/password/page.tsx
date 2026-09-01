import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth-client.ts';
import { updatePassword } from '../../actions/auth.ts';

/** 비밀번호 재설정 링크를 타고 들어온 자리. 세션이 이미 열려 있어야 한다. */
export default async function NewPassword({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await currentUser())) redirect('/login');
  const q = await searchParams;

  async function save(formData: FormData) {
    'use server';
    const r = await updatePassword(formData);
    if (!r.ok) redirect(`/account/password?error=${encodeURIComponent(r.message)}`);
  }

  return (
    <main className="landing">
      <a href="/" className="logo" aria-label="Ledger 첫 화면으로">
        Ledger
      </a>

      <div className="auth">
        <h1 className="auth-title">새 비밀번호</h1>
        {q.error && <p className="notice">{q.error}</p>}

        <form action={save}>
          <label className="field">
            <span className="lab">새 비밀번호</span>
            <input type="password" name="password" required minLength={8} autoComplete="new-password" />
          </label>
          <button className="act primary" type="submit" style={{ marginTop: 18, width: '100%' }}>
            저장
          </button>
        </form>
      </div>
    </main>
  );
}
