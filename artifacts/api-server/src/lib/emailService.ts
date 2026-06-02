type EmailResult =
  | { status: "sent"; messageId: string | null }
  | { status: "not_configured"; error: string }
  | { status: "failed"; error: string };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailFromAddress() {
  return process.env.INVITE_EMAIL_FROM?.trim()
    || process.env.EMAIL_FROM?.trim()
    || "";
}

export function inviteEmailReady() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && emailFromAddress());
}

export async function sendStaffInviteEmail(input: {
  to: string;
  staffName?: string | null;
  companyName: string;
  inviteUrl: string;
  inviteCode: string;
  expiresAt: Date;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = emailFromAddress();
  const replyTo = process.env.INVITE_EMAIL_REPLY_TO?.trim() || process.env.EMAIL_REPLY_TO?.trim();

  if (!apiKey || !from) {
    return {
      status: "not_configured",
      error: "Set RESEND_API_KEY and INVITE_EMAIL_FROM in Render to send staff invite emails.",
    };
  }

  const greeting = input.staffName?.trim() ? `Hi ${input.staffName.trim()},` : "Hi,";
  const expiry = input.expiresAt.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const subject = `${input.companyName} invited you to SealFlow`;
  const text = [
    greeting,
    "",
    `${input.companyName} has invited you to create a staff admin account in SealFlow.`,
    "",
    `Invite link: ${input.inviteUrl}`,
    `Invite code: ${input.inviteCode}`,
    `Expires: ${expiry}`,
    "",
    "If you were not expecting this invite, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#171717;max-width:560px">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(input.companyName)}</strong> has invited you to create a staff admin account in SealFlow.</p>
      <p>
        <a href="${escapeHtml(input.inviteUrl)}" style="display:inline-block;background:#f97316;color:#111111;text-decoration:none;font-weight:700;padding:12px 16px;border-radius:6px">
          Accept staff invite
        </a>
      </p>
      <p style="font-size:14px;color:#525252">Invite code:</p>
      <p style="font-family:Consolas,monospace;font-size:18px;font-weight:700;letter-spacing:1px">${escapeHtml(input.inviteCode)}</p>
      <p style="font-size:14px;color:#525252">This invite expires ${escapeHtml(expiry)}.</p>
      <p style="font-size:12px;color:#737373">If you were not expecting this invite, you can ignore this email.</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    const data = await response.json().catch(() => null) as { id?: string; message?: string; error?: string } | null;
    if (!response.ok) {
      return {
        status: "failed",
        error: data?.message || data?.error || `Resend returned HTTP ${response.status}`,
      };
    }

    return { status: "sent", messageId: data?.id ?? null };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Email sending failed",
    };
  }
}
