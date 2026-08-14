import { useLanguage } from "@/lib/language-context";

export default function PrivacyPage() {
  const { isEn } = useLanguage();

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-1">
        {isEn ? "Privacy Policy" : "개인정보처리방침"}
      </h1>
      <p className="text-sm text-muted-foreground mb-8">
        {isEn
          ? "Effective: January 1, 2025 · Last updated: August 15, 2026"
          : "시행일: 2025년 1월 1일 · 최종 수정: 2026년 8월 15일"}
      </p>

      <Section title={isEn ? "1. Information We Collect" : "1. 수집하는 개인정보 항목"}>
        {isEn ? (
          <>
            <p>AiBITDA (operated by CBST, hereinafter "Company") collects the following information to provide its service.</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Kakao social login:</strong> Kakao account ID, nickname, profile image</li>
              <li><strong>Google social login:</strong> Google account identifier, name, profile image</li>
              <li><strong>Automatically collected during use:</strong> IP address, browser type and OS, service usage history (analysis request history), access timestamps</li>
            </ul>
          </>
        ) : (
          <>
            <p>애빛다(운영: CBST, 이하 "회사")는 서비스 제공을 위해 아래 항목을 수집합니다.</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>카카오 소셜 로그인 시</strong>: 카카오 계정 식별자(ID), 닉네임, 프로필 이미지</li>
              <li><strong>서비스 이용 중 자동 수집</strong>: 접속 IP, 브라우저 종류 및 OS, 서비스 이용 기록(분석 요청 이력), 접속 일시</li>
            </ul>
          </>
        )}
      </Section>

      <Section title={isEn ? "2. Purpose of Collection & Use" : "2. 개인정보의 수집 및 이용 목적"}>
        <ul className="list-disc pl-5 space-y-1">
          {isEn ? (
            <>
              <li>Member registration and identity verification</li>
              <li>Provision and history management of AI company analysis services</li>
              <li>Service improvement and error response</li>
              <li>Legal compliance and dispute resolution</li>
            </>
          ) : (
            <>
              <li>회원 가입 및 본인 확인</li>
              <li>AI 기업분석 서비스 제공 및 이력 관리</li>
              <li>서비스 개선 및 오류 대응</li>
              <li>법령 의무 이행 및 분쟁 해결</li>
            </>
          )}
        </ul>
      </Section>

      <Section title={isEn ? "3. Retention & Use Period" : "3. 개인정보의 보유 및 이용 기간"}>
        {isEn ? (
          <>
            <p>Upon membership withdrawal or consent revocation, data is immediately destroyed. However, if retention is required by relevant laws, data is retained for the applicable period.</p>
            <table className="mt-3 w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="border border-border px-3 py-2">Legal Basis</th>
                  <th className="border border-border px-3 py-2">Retention Period</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border px-3 py-2">Act on Consumer Protection in Electronic Commerce – contract and withdrawal records</td>
                  <td className="border border-border px-3 py-2">5 years</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2">Protection of Communications Secrets Act – service usage logs</td>
                  <td className="border border-border px-3 py-2">3 months</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <>
            <p>회원 탈퇴 또는 동의 철회 시 즉시 파기합니다. 단, 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.</p>
            <table className="mt-3 w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="border border-border px-3 py-2">보존 근거</th>
                  <th className="border border-border px-3 py-2">보존 기간</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border px-3 py-2">전자상거래 등에서의 소비자보호에 관한 법률 – 계약 및 청약철회 기록</td>
                  <td className="border border-border px-3 py-2">5년</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2">통신비밀보호법 – 서비스 이용 로그</td>
                  <td className="border border-border px-3 py-2">3개월</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title={isEn ? "4. Disclosure to Third Parties" : "4. 개인정보의 제3자 제공"}>
        <p>
          {isEn
            ? "As a principle, the Company does not provide users' personal information to third parties. Exceptions apply when the user has consented or when required by law."
            : "회사는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만, 이용자의 동의가 있거나 법령에 의한 경우는 예외입니다."}
        </p>
      </Section>

      <Section title={isEn ? "5. Data Processing Entrusted to Third Parties" : "5. 개인정보 처리 위탁"}>
        {isEn ? (
          <>
            <p>The Company entrusts personal data processing to the following companies for service operation.</p>
            <table className="mt-3 w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="border border-border px-3 py-2">Vendor</th>
                  <th className="border border-border px-3 py-2">Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border px-3 py-2">Kakao Corp.</td>
                  <td className="border border-border px-3 py-2">Social login authentication</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2">Google LLC (Gemini)</td>
                  <td className="border border-border px-3 py-2">AI analysis processing</td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <>
            <p>회사는 서비스 운영을 위해 아래 업체에 개인정보 처리를 위탁합니다.</p>
            <table className="mt-3 w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="border border-border px-3 py-2">수탁 업체</th>
                  <th className="border border-border px-3 py-2">위탁 업무</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border px-3 py-2">카카오(주)</td>
                  <td className="border border-border px-3 py-2">소셜 로그인 인증</td>
                </tr>
                <tr>
                  <td className="border border-border px-3 py-2">Google LLC (Gemini)</td>
                  <td className="border border-border px-3 py-2">AI 분석 처리</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title={isEn ? "6. User Rights" : "6. 이용자의 권리"}>
        {isEn ? (
          <>
            <p>Users may exercise the following rights at any time.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Request to access, correct, or delete personal information</li>
              <li>Request to suspend processing</li>
              <li>Revoke consent and withdraw membership (Settings &gt; Delete Account)</li>
            </ul>
            <p className="mt-2">Submit requests through in-app Support (Menu → Support) or the Settings page.</p>
          </>
        ) : (
          <>
            <p>이용자는 언제든지 다음 권리를 행사할 수 있습니다.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>개인정보 열람·정정·삭제 요청</li>
              <li>처리 정지 요청</li>
              <li>동의 철회 및 회원 탈퇴 (설정 &gt; 계정 탈퇴)</li>
            </ul>
            <p className="mt-2">요청은 앱 내 관리자 문의(메뉴 → 고객 문의) 또는 설정 페이지에서 접수하실 수 있습니다.</p>
          </>
        )}
      </Section>

      <Section title={isEn ? "7. Cookies & Sessions" : "7. 쿠키 및 세션"}>
        <p>
          {isEn
            ? "We use session cookies to maintain login state. You may disable cookies in your browser settings, but some service features may be restricted as a result."
            : "로그인 상태 유지를 위해 세션 쿠키를 사용합니다. 브라우저 설정으로 쿠키를 거부할 수 있으나, 일부 서비스 이용이 제한될 수 있습니다."}
        </p>
      </Section>

      <Section title={isEn ? "8. Privacy Officer" : "8. 개인정보 보호책임자"}>
        {isEn ? (
          <>
            <p>
              For privacy-related inquiries, complaints, or remediation, use{" "}
              <strong>Support</strong> inside the app (Menu → Support). We reply in the same thread,
              so you can see the history of your request.
            </p>
            <ul className="list-none mt-2 space-y-1">
              <li>Officer: Privacy Officer (CBST)</li>
              <li>Channel: In-app Support</li>
            </ul>
          </>
        ) : (
          <>
            <p>
              개인정보 관련 문의·불만·피해구제 등은 앱 안의 <strong>관리자 문의</strong>(메뉴 → 고객 문의)로
              접수해 주십시오. 같은 대화에 답변이 달려 처리 경과를 함께 보실 수 있습니다.
            </p>
            <ul className="list-none mt-2 space-y-1">
              <li>담당자: 개인정보 보호책임자 (CBST)</li>
              <li>접수 창구: 앱 내 관리자 문의</li>
            </ul>
          </>
        )}
      </Section>

      <Section title={isEn ? "9. Policy Changes" : "9. 개인정보처리방침 변경"}>
        <p>
          {isEn
            ? "This policy may be revised in accordance with changes in law or service. Any changes will be announced in advance via the Notices page."
            : "본 방침은 법령 또는 서비스 변경에 따라 개정될 수 있으며, 변경 시 공지사항을 통해 사전에 안내합니다."}
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-3 pb-1 border-b border-border">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
