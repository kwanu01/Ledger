import { redirect } from 'next/navigation';
import { teamForInvite } from '../../../lib/access.ts';
import { db } from '../../../lib/db/client.ts';
import { currentUser } from '../../../lib/auth-client.ts';
import { getLang } from '../../../lib/lang.ts';
import { translator } from '../../../lib/i18n.ts';
import { joinTeam } from '../../actions/teams.ts';
import { signInWith } from '../../actions/auth.ts';
import AuthForm from '../../login/AuthForm.tsx';
import { Say } from '../../helper/HelperContext.tsx';
import Logo from '../../Logo.tsx';

/**
 * 초대 링크 (§5.2)
 *
 * 팀원이 늘어나는 유일한 길이다. 장부를 만든 사람이 남의 이름을 대신 적어 두지
 * 않는다. 링크를 받은 사람이 스스로 이름을 적고 들어와야 명단에 오른다.
 *
 * 링크만으로는 들어오지 못한다. 로그인을 한 번 거쳐야 한다. 그래야 이 장부가
 * 그 사람의 목록에 남고, 다음에 다른 기기에서 들어와도 같은 사람이 된다.
 * 자기 계좌를 자기가 적고, 보냈어요·받았어요가 본인 것으로 남는 근거가 여기다.
 */
export default async function Join({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const q = await searchParams;
  const teamId = await teamForInvite(token);
  const lang = await getLang();
  const T = translator(lang);

  if (!teamId) {
    return (
      <main className="gate">
        <div className="topbar" style={{ paddingTop: 0, marginBottom: 44 }}>
          <Logo />
        </div>
        <h1 style={{ fontSize: 20 }}>{T('inviteDead')}</h1>
        <p className="muted" style={{ marginTop: 10 }}>
          {T('inviteDeadWhy')}
        </p>
      </main>
    );
  }

  const [{ data: team }, user] = await Promise.all([
    db.from('teams').select('name').eq('id', teamId).single(),
    currentUser(),
  ]);

  async function join(formData: FormData) {
    'use server';
    const r = await joinTeam({ token, name: String(formData.get('name') ?? '') });
    if (!r.ok) redirect(`/join/${token}?error=${encodeURIComponent(r.message)}`);
    redirect(r.value.ledgerId ? `/l/${r.value.ledgerId}` : '/teams');
  }

  async function google() {
    'use server';
    await signInWith('google', `/join/${token}`);
  }

  async function kakao() {
    'use server';
    await signInWith('kakao', `/join/${token}`);
  }

  // 로그인이 먼저다. 마치면 이 주소로 돌아와 이름을 적는다.
  if (!user) {
    return (
      <main className="landing">
        <Logo plain />
        <AuthForm
          google={google}
          kakao={kakao}
          kakaoReady={process.env.NEXT_PUBLIC_KAKAO_LOGIN === '1'}
          locale={lang}
          next={`/join/${token}`}
          title={team?.name}
        />
      </main>
    );
  }

  return (
    <main className="gate">
      <div className="topbar" style={{ paddingTop: 0, marginBottom: 44 }}>
        <Logo />
      </div>

      {/* 무엇에 들어가는지는 팀 이름이 말한다. 그 위에 문장을 더 얹지 않는다. */}
      <h1 className="auth-title" style={{ textAlign: 'left', marginBottom: 0 }}>
        {team?.name}
      </h1>

      <Say text={q.error} />

      <form action={join} style={{ marginTop: 28, maxWidth: 320 }}>
        <label className="field">
          <span className="lab">{T('yourNameHere')}</span>
          <input
            type="text"
            name="name"
            required
            autoFocus
            defaultValue={user?.displayName ?? ''}
            autoComplete="name"
          />
        </label>
        <button type="submit" className="act primary" style={{ marginTop: 18, width: '100%' }}>
          {T('joinAs')}
        </button>
      </form>
    </main>
  );
}
