import { config } from "../config.js";

export async function send({ to, subject, text }) {
  if (!config.mail.resendKey) {
    console.log(`\n[mailer:dev] To: ${to}\n[mailer:dev] ${subject}\n[mailer:dev] ${text}\n`);
    return { dev: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.mail.resendKey}` },
    body: JSON.stringify({ from: config.mail.from, to, subject, text }),
  });
  if (!res.ok) throw new Error(`mailer ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
export function verifyEmail(appUrl, token) {
  return { subject: "Confirm your Crucible account",
    text: `Confirm your email to start testing decisions:\n\n${appUrl}/api/auth/verify?token=${token}\n\nExpires in 24 hours.` };
}
export function resetEmail(appUrl, token) {
  return { subject: "Reset your Crucible password",
    text: `Reset your password:\n\n${appUrl}/app?reset=${token}\n\nIf you didn't request this, ignore it. Expires in 1 hour.` };
}
