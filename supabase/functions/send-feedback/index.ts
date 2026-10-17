import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const recipient = "naufalnur7@gmail.com";
const maxAttachmentBytes = 4 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Silakan login sebelum mengirim laporan." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !resendApiKey) {
    console.error("Feedback email service is missing required environment variables.");
    return jsonResponse({ error: "Layanan laporan belum dikonfigurasi." }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonResponse({ error: "Sesi login tidak valid. Silakan login kembali." }, 401);

  let payload: {
    type?: unknown;
    description?: unknown;
    attachment?: {
      fileName?: unknown;
      contentType?: unknown;
      contentBase64?: unknown;
    } | null;
  };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Format laporan tidak valid." }, 400);
  }

  if (payload.type !== "bug" && payload.type !== "feedback") {
    return jsonResponse({ error: "Jenis laporan tidak valid." }, 400);
  }
  if (typeof payload.description !== "string" || !payload.description.trim() || payload.description.length > 5000) {
    return jsonResponse({ error: "Deskripsi wajib diisi dan maksimal 5.000 karakter." }, 400);
  }

  const attachments: Array<{ filename: string; content: string }> = [];
  if (payload.attachment) {
    const { fileName, contentType, contentBase64 } = payload.attachment;
    if (
      typeof fileName !== "string" ||
      typeof contentType !== "string" ||
      typeof contentBase64 !== "string" ||
      !allowedImageTypes.has(contentType) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64) ||
      contentBase64.length > Math.ceil(maxAttachmentBytes / 3) * 4
    ) {
      return jsonResponse({ error: "Foto tidak valid atau ukurannya melebihi 4 MB." }, 400);
    }

    let decodedSize: number;
    try {
      decodedSize = atob(contentBase64).length;
    } catch {
      return jsonResponse({ error: "Format foto tidak valid." }, 400);
    }
    if (decodedSize > maxAttachmentBytes) {
      return jsonResponse({ error: "Ukuran foto maksimal 4 MB." }, 400);
    }

    const safeFileName = fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "lampiran";
    attachments.push({ filename: safeFileName, content: contentBase64 });
  }

  const reportType = payload.type === "bug" ? "Laporan bug" : "Masukan sistem";
  const emailPayload = {
    from: Deno.env.get("RESEND_FROM_EMAIL") || "Pundi <onboarding@resend.dev>",
    to: [recipient],
    reply_to: user.email || undefined,
    subject: `[Pundi] ${reportType}`,
    text: [
      `Jenis: ${reportType}`,
      "",
      "Deskripsi:",
      payload.description.trim(),
      "",
      `Pengirim: ${user.email || "Email tidak tersedia"}`,
      `User ID: ${user.id}`,
    ].join("\n"),
    ...(attachments.length ? { attachments } : {}),
  };

  let resendResponse: Response;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });
  } catch (error) {
    console.error("Unable to reach Resend.", error);
    return jsonResponse({ error: "Layanan email tidak dapat dihubungi. Coba lagi nanti." }, 502);
  }

  if (!resendResponse.ok) {
    const errorDetails = await resendResponse.text();
    console.error("Resend rejected the feedback email.", { status: resendResponse.status, error: errorDetails });
    return jsonResponse({ error: "Email gagal dikirim. Periksa konfigurasi Resend dan coba lagi." }, 502);
  }

  return jsonResponse({ sent: true });
});
