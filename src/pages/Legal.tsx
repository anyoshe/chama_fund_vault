import { Link, useParams } from "react-router-dom";

const TERMS = `
# Terms of Use — ChamaVault

Last updated: September 2026

ChamaVault is a digital treasury tool for savings groups (chamas). By creating an account or joining a chama on this platform, you agree to these terms.

## 1. Nature of the service
ChamaVault provides record-keeping, governance (voting), and treasury views. It is not a bank, Sacco, or payment service provider. Until live payment rails are enabled, money movement may be recorded by members/officials rather than executed inside the app.

## 2. Your responsibilities
- Provide accurate registration details.
- Protect your login credentials.
- Use the platform only for lawful chama activity.
- Officials (Chairperson, Treasurer, Secretary) act in the interest of members and comply with the group's constitution.

## 3. Funds and disputes
Balances shown are based on data entered and confirmed in the system. Disputes about physical cash, M-Pesa, or bank transfers remain between members and the chama leadership. ChamaVault does not hold member deposits.

## 4. Availability
We aim for reliable service but do not guarantee uninterrupted access. You should export statements regularly for your records.

## 5. Account suspension
We may suspend access for abuse, fraud suspicion, or legal requirements.

## 6. Governing law
These terms are governed by the laws of Kenya. Courts in Kenya have jurisdiction, subject to applicable consumer protections.

## 7. Contact
Use the support channel published by your chama operator or the platform operator.
`.trim();

const PRIVACY = `
# Privacy Policy — ChamaVault

Last updated: September 2026

## Data we process
- Account data: name, email and/or phone, role in a chama.
- Treasury data: contributions, loans, votes, kit balances, audit descriptions.
- Technical logs: authentication and error logs needed to run the service.

## Why we process it
To operate multi-member chamas, enforce roles, compute loan limits, and show financial summaries.

## Storage
Data is stored in a cloud database (e.g. Supabase/Postgres) with access control. Officials of a chama can see group financial data for that chama.

## Sharing
We do not sell personal data. Data may be processed by infrastructure providers under contract. We may disclose information if required by law.

## Retention
Data is retained while the chama account is active and for a reasonable period afterward for audit integrity, unless deletion is requested and legally permitted.

## Your rights
Subject to Kenyan data protection law, you may request access, correction, or deletion of personal data where applicable. Contact the platform operator.

## Security
We use industry-standard controls (encryption in transit, authenticated APIs, role checks). No system is perfectly secure; protect your password and devices.

## Children
The service is intended for adults participating in lawful savings groups.
`.trim();

function renderMarkdownLite(md: string) {
  return md.split("\n").map((line, i) => {
    if (line.startsWith("# "))
      return (
        <h1 key={i} className="text-2xl font-bold text-white">
          {line.slice(2)}
        </h1>
      );
    if (line.startsWith("## "))
      return (
        <h2 key={i} className="mt-6 text-lg font-bold text-emerald-300">
          {line.slice(3)}
        </h2>
      );
    if (!line.trim()) return <div key={i} className="h-2" />;
    return (
      <p key={i} className="text-sm leading-relaxed text-slate-300">
        {line}
      </p>
    );
  });
}

export default function Legal() {
  const { doc } = useParams();
  const isPrivacy = doc === "privacy";
  const body = isPrivacy ? PRIVACY : TERMS;

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-xs font-semibold text-emerald-400 hover:underline">
          ← Back to ChamaVault
        </Link>
        <article className="mt-6 space-y-1 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          {renderMarkdownLite(body)}
        </article>
        <p className="mt-6 text-center text-[11px] text-slate-600">
          Template for operators — have counsel review before commercial launch.
        </p>
      </div>
    </div>
  );
}
