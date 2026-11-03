const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "connect-src https://smart-home-api-v2.mykola-taran-88.workers.dev https://cdnjs.cloudflare.com",
  "img-src 'self' data:",
  "font-src 'self' data:",
].join("; ");

const HTML_PATHS = new Set(["/", "/index.html"]);

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);

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
