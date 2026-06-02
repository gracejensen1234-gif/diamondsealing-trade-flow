import tls from "node:tls";

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

function smtpPassword() {
  return process.env.SMTP_PASS?.replace(/\s+/g, "") || "";
}

export function inviteEmailReady() {
  return Boolean(
    (process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && smtpPassword() && emailFromAddress())
    || (process.env.RESEND_API_KEY?.trim() && emailFromAddress()),
  );
}

export async function sendStaffInviteEmail(input: {
  to: string;
  staffName?: string | null;
  companyName: string;
  inviteUrl: string;
  inviteCode: string;
  expiresAt: Date;
}): Promise<EmailResult> {
  const from = emailFromAddress();
  if (process.env.SMTP_HOST?.trim()) return sendWithSmtp(input, from);
  return sendWithResend(input, from);
}

async function sendWithResend(input: {
  to: string;
  staffName?: string | null;
  companyName: string;
  inviteUrl: string;
  inviteCode: string;
  expiresAt: Date;
}, from: string): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const replyTo = process.env.INVITE_EMAIL_REPLY_TO?.trim() || process.env.EMAIL_REPLY_TO?.trim();
  if (!apiKey || !from) {
    return {
      status: "not_configured",
      error: "Set SMTP settings or RESEND_API_KEY and INVITE_EMAIL_FROM in Render to send staff invite emails.",
    };
  }

  const content = staffInviteContent(input);

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
        subject: content.subject,
        html: content.html,
        text: content.text,
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

async function sendWithSmtp(input: {
  to: string;
  staffName?: string | null;
  companyName: string;
  inviteUrl: string;
  inviteCode: string;
  expiresAt: Date;
}, from: string): Promise<EmailResult> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = smtpPassword();
  const port = Number(process.env.SMTP_PORT || 465);
  const replyTo = process.env.INVITE_EMAIL_REPLY_TO?.trim() || process.env.EMAIL_REPLY_TO?.trim();
  const fromAddress = emailAddressOnly(from);

  if (!host || !user || !pass || !from) {
    return {
      status: "not_configured",
      error: "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and INVITE_EMAIL_FROM in Render.",
    };
  }

  const content = staffInviteContent(input);
  const messageId = `<staff-invite-${Date.now()}-${Math.random().toString(16).slice(2)}@sealflow>`;
  const message = buildEmailMessage({
    from,
    to: input.to,
    replyTo,
    subject: content.subject,
    text: content.text,
    html: content.html,
    messageId,
  });

  try {
    await smtpSend({
      host,
      port,
      user,
      pass,
      fromAddress: fromAddress || user,
      to: input.to,
      message,
    });
    return { status: "sent", messageId };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "SMTP email sending failed",
    };
  }
}

function staffInviteContent(input: {
  staffName?: string | null;
  companyName: string;
  inviteUrl: string;
  inviteCode: string;
  expiresAt: Date;
}) {
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
  return { subject, text, html };
}

function emailAddressOnly(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim();
}

function encodeHeader(value: string) {
  return /[^\x00-\x7F]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value;
}

function buildEmailMessage(input: {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
}) {
  const boundary = `sealflow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = [
    `Message-ID: ${input.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    input.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    input.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function smtpSend(input: {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromAddress: string;
  to: string;
  message: string;
}) {
  const socket = tls.connect({
    host: input.host,
    port: input.port,
    servername: input.host,
  });
  socket.setEncoding("utf8");

  let buffer = "";
  let pending: ((line: string) => void) | null = null;
  let pendingReject: ((error: Error) => void) | null = null;
  const queuedLines: string[] = [];
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index + 1);
      buffer = buffer.slice(index + 1);
      if (pending) {
        const resolve = pending;
        pending = null;
        pendingReject = null;
        resolve(line);
      } else {
        queuedLines.push(line);
      }
    }
  });
  socket.on("error", (error) => {
    pendingReject?.(error);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });

  async function nextLine() {
    const queued = queuedLines.shift();
    if (queued) return queued.replace(/\r?\n$/, "");
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("SMTP response timed out")), 20000);
      pendingReject = (error) => {
        clearTimeout(timer);
        pending = null;
        pendingReject = null;
        reject(error);
      };
      pending = (line) => {
        clearTimeout(timer);
        pendingReject = null;
        resolve(line.replace(/\r?\n$/, ""));
      };
    });
  }

  async function readResponse() {
    const lines: string[] = [];
    for (;;) {
      const line = await nextLine();
      lines.push(line);
      if (/^\d{3} /.test(line)) return lines;
    }
  }

  async function command(value: string, expected: number[]) {
    socket.write(`${value}\r\n`);
    const lines = await readResponse();
    const code = Number(lines[0]?.slice(0, 3));
    if (!expected.includes(code)) throw new Error(`SMTP ${code}: ${lines.join(" ")}`);
    return lines;
  }

  try {
    const greeting = await readResponse();
    if (!greeting[0]?.startsWith("220")) throw new Error(`SMTP greeting failed: ${greeting.join(" ")}`);
    await command("EHLO sealflow.app", [250]);
    await command(`AUTH PLAIN ${Buffer.from(`\0${input.user}\0${input.pass}`).toString("base64")}`, [235]);
    await command(`MAIL FROM:<${input.fromAddress}>`, [250]);
    await command(`RCPT TO:<${input.to}>`, [250, 251]);
    await command("DATA", [354]);
    socket.write(`${dotStuff(input.message)}\r\n.\r\n`);
    const dataResponse = await readResponse();
    const dataCode = Number(dataResponse[0]?.slice(0, 3));
    if (dataCode !== 250) throw new Error(`SMTP ${dataCode}: ${dataResponse.join(" ")}`);
    await command("QUIT", [221]);
  } finally {
    socket.end();
  }
}

function dotStuff(value: string) {
  return value
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => line.startsWith(".") ? `.${line}` : line)
    .join("\r\n");
}
