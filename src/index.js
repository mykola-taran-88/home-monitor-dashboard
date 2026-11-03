const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://smart-home-api-v2.mykola-taran-88.workers.dev https://cdnjs.cloudflare.com",
  "img-src 'self' data:",
  "font-src 'self' data:",
].join("; ");

const HTML_PATHS = new Set(["/", "/index.html"]);

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);

    if (
      requestUrl.pathname === "/assistant/chat" ||
      requestUrl.pathname === "/assistant/chat/clear"
    ) {
      if (request.method !== "POST")
        return Response.json({ error: "Method Not Allowed" }, { status: 405 });
      const origin = request.headers.get("Origin");
      if (origin && new URL(origin).host !== requestUrl.host)
        return Response.json(
          { error: "Origin is not allowed" },
          { status: 403 },
        );
      if (!env.HOME_MONITOR_BOT || !env.DASHBOARD_AI_INTERNAL_SECRET)
        return Response.json(
          { error: "AI-помічник ще не налаштований." },
          { status: 503 },
        );

      const raw = await request.text();
      if (raw.length > 5000)
        return Response.json({ error: "Завеликий запит." }, { status: 413 });
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return Response.json({ error: "Некоректний запит." }, { status: 400 });
      }
      const conversation = String(payload.conversationId || "");
      if (!/^[a-f0-9-]{36}$/i.test(conversation))
        return Response.json(
          { error: "Некоректний ідентифікатор чату." },
          { status: 400 },
        );
      const isClear = requestUrl.pathname.endsWith("/clear");
      const botResponse = await env.HOME_MONITOR_BOT.fetch(
        new Request(
          `https://home-monitor-bot.internal/internal/web-chat${isClear ? "/clear" : ""}?conversation=${encodeURIComponent(conversation)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Dashboard-AI-Secret": env.DASHBOARD_AI_INTERNAL_SECRET,
              "X-Home-Monitor-Client-IP":
                request.headers.get("CF-Connecting-IP") || "unknown",
            },
            body: JSON.stringify({ message: payload.message }),
          },
        ),
      );
      return new Response(botResponse.body, {
        status: botResponse.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (!HTML_PATHS.has(requestUrl.pathname)) {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    // The asset handler treats / as the canonical URL for index.html.
    requestUrl.pathname = "/";
    const assetResponse = await env.ASSETS.fetch(
      new Request(requestUrl, request),
    );
    const headers = new Headers(assetResponse.headers);

    headers.set("Content-Type", "text/html; charset=UTF-8");
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
