const MAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'rekuac01@gmail.com';
const ADS = Boolean(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);
const heading = {
  width: 112, padding: '12px 18px 12px 0', textAlign: 'left', verticalAlign: 'top',
  fontSize: 13, fontWeight: 500, lineHeight: 1.95,
} as const;

export default function PrivacyEnglish() {
  return <>
    <h1>Privacy Policy</h1>
    <p className="faint">Last updated September 26, 2026</p>
    <p>teamLedger is a web service and iPhone app for recording and settling shared expenses. This policy explains what information we handle, where it is stored, and how you can request deletion.</p>

    <h2>On-device and connected ledgers</h2>
    <p>Personal book names, budgets, items, and amounts entered on the web home page are saved only in that browser. They are not linked to your account or team ledgers and do not sync to other devices. Use “Delete book” to remove a book and its entries. Data from the earlier personal calculator may remain in your browser; you can review and remove it on the <a href="/personal/previous">previous personal records page</a>.</p>
    <p>Ledgers used without signing in, drafts, and appearance, sound, and reminder settings stay on your device. Connecting an account does not automatically upload or merge an existing on-device ledger.</p>
    <p>Entries saved to a connected ledger are stored on our servers and shared with members who can access that ledger. Exported PDF and CSV reports go to the app or location you choose. Reminders are scheduled on your device only after you enable them. We do not currently send remote push notifications for team activity.</p>

    <h2>Information we process</h2>
    <p><b>Account.</b> We process your email address, display name, user identifier, and authentication information to sign you in and control ledger access. When you use an external sign-in provider, we receive the information that provider sends with your consent. Sign in with Apple may provide a private relay address. We do not receive your external account password.</p>
    <p><b>Ledger records.</b> We store items, amounts, dates, merchants, categories, notes, payers, allocations, income, dues, budgets, settlements, and transfer confirmations. This includes values you enter, calculated results, and review or change status. We do not read bank transactions or initiate transfers.</p>
    <p><b>Photos.</b> When you ask us to read a receipt, the selected image is sent to our AI processor. The iPhone app does not automatically keep that image as a ledger attachment. A photo that you explicitly attach on the web is stored on our server and shown only after ledger access is checked.</p>
    <p><b>Usage and connection records.</b> To operate AI limits and diagnose failures, we may store the ledger ID, model, usage, cost, result status, and time. Hosting and authentication providers also process connection and error logs for operation and security.</p>
    <p><b>Support.</b> We process the contact information and message you send so we can reply and resolve the issue.</p>

    <h2>Sujeung and AI processing</h2>
    <p>When you request an AI feature, teamLedger sends the relevant information through our server to Anthropic’s Claude API. The app explains the transfer and asks for consent before making the request.</p>
    <table className="facts"><tbody>
      <tr><th scope="row" style={heading}>Ledger questions</th><td>Your question, recent conversation, team and ledger names, member names, entries, allocations, and accounting summary. The summary may include item, amount, date, merchant, and note.</td></tr>
      <tr><th scope="row" style={heading}>Quick entry</th><td>The sentence you entered, member names, author, ledger currency, and date.</td></tr>
      <tr><th scope="row" style={heading}>Receipt reading</th><td>The receipt image you selected and asked us to read.</td></tr>
      <tr><th scope="row" style={heading}>Payment request</th><td>The requester and recipient names, amount, and request type.</td></tr>
    </tbody></table>
    <p>Choosing a photo alone does not send it. AI-generated entries are saved only after you review them, and generated request text is not automatically sent to another person. You may decline or withdraw AI consent and continue using manual entry and calculations. Withdrawing consent applies to future requests.</p>
    <p>Our AI processor may retain request and response data for security, policy, or legal requirements in addition to processing the request. See <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data" target="_blank" rel="noreferrer noopener">Anthropic’s API data retention information</a>.</p>

    <h2>Sign-in and device storage</h2>
    <p>The iPhone app stores its session in secure device storage. The web service uses cookies for sign-in, invite access, language, and returning to the requested page.</p>
    <p>For Sign in with Apple, our server verifies the authorization code and stores an encrypted token needed to revoke the Apple connection later. We do not store the authorization code itself. When you delete your account, we request revocation and tell you if manual action may still be required.</p>

    <h2>Service providers and locations</h2>
    <table className="facts"><tbody>
      <tr><th scope="row" style={heading}>Supabase</th><td>Authentication and storage of accounts, connected ledgers, and attached photos</td></tr>
      <tr><th scope="row" style={heading}>Vercel</th><td>Web and app server requests, hosting, and connection or error logs</td></tr>
      <tr><th scope="row" style={heading}>Anthropic</th><td>AI answers, entry organization, and receipt analysis requested by you</td></tr>
      <tr><th scope="row" style={heading}>Apple</th><td>Sign in with Apple and revocation</td></tr>
      <tr><th scope="row" style={heading}>Google</th><td>Google sign-in{ADS ? ' and web advertising' : ''}</td></tr>
      <tr><th scope="row" style={heading}>Kakao</th><td>Kakao sign-in or sharing when used on the web</td></tr>
    </tbody></table>
    <p>Our primary Supabase database is located in Seoul. Authentication, hosting, AI processing, and provider operations may transfer or process information outside Korea.</p>

    {ADS && <><h2>Web advertising</h2><p>Google AdSense may appear on web product and archive pages. The iPhone app contains no advertising. Advertising providers may use cookies, but teamLedger does not place ledger contents in advertising requests. You can manage personalized ads in <a href="https://myadcenter.google.com/" target="_blank" rel="noreferrer noopener">Google My Ad Center</a>.</p></>}

    <h2>Retention and deletion</h2>
    <p>We retain server account and ledger information while providing sign-in, recording, and settlement features. The account deletion screen shows what will be removed and which ledgers must be handled first. An owner may need to transfer ownership of a shared ledger.</p>
    <p>After account deletion, we delete the account and profile and replace the member name in retained shared records with “Deleted member.” Amounts, allocations, and settlement records may remain so the other members’ accounting remains correct. Some authored content and photos are deleted or de-identified where we can reliably identify the author.</p>
    <p>Historical or collaboratively edited content may not have a reliable author. If personal information remains there, review it before deletion or contact us. On-device ledgers, exported reports, files downloaded by other members, backups, security logs, and a provider’s own retention are separate from deleting records in the service.</p>

    <h2>Your rights and contact</h2>
    <p>You may request access, correction, deletion, or restriction of your personal information. If the app cannot complete the request, or personal information remains in a shared record, contact us at <a href={`mailto:${MAIL}`}>{MAIL}</a>.</p>

    <h2>Children</h2>
    <p>teamLedger is not directed to children under 14.</p>

    <h2>Changes</h2>
    <p>We update the date above when this policy changes. We will provide notice in the service before a material change affecting your rights takes effect.</p>
  </>;
}
