// cloudflare-worker/worker.ts
var USER_AGENT = "CER_IKE_01/2.3.0 (iPad; iOS 26.3; Scale/2.00)";
var ALLOWED_HOSTS = /* @__PURE__ */ new Set(["iov-tap.mgindia.co.in", "iov-gateway.mgindia.co.in"]);
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "APP-SEND-DATE, ORIGINAL-CONTENT-TYPE, app-send-date, original-content-type, x-mg-send-date"
};
var worker_default = {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const reqUrl = new URL(request.url);
    const targetUrlStr = reqUrl.searchParams.get("url");
    if (!targetUrlStr) {
      return new Response(
        JSON.stringify({ status: "ok", service: "MG iSMART India Edge Worker" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid target URL" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }
    if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return new Response(JSON.stringify({ error: "Forbidden target host" }), {
        status: 403,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }
    try {
      const forwardHeaders = new Headers();
      forwardHeaders.set("User-Agent", USER_AGENT);
      for (const [k, v] of request.headers.entries()) {
        const upper = k.toUpperCase();
        if (upper.startsWith("APP-") || upper === "SIGNATURE" || upper === "ORIGINAL-CONTENT-TYPE" || upper === "CONTENT-TYPE" || upper === "ACCEPT" || upper === "ACCEPT-LANGUAGE") {
          forwardHeaders.set(upper, v);
        }
      }
      const upstream = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        body: request.method !== "GET" && request.method !== "HEAD" ? await request.text() : void 0
      });
      const outHeaders = new Headers(CORS_HEADERS);
      outHeaders.set("Content-Type", upstream.headers.get("Content-Type") || "text/plain");
      const sendDate = upstream.headers.get("APP-SEND-DATE") || upstream.headers.get("app-send-date");
      if (sendDate) {
        outHeaders.set("APP-SEND-DATE", sendDate);
        outHeaders.set("x-mg-send-date", sendDate);
      }
      const origCt = upstream.headers.get("ORIGINAL-CONTENT-TYPE") || upstream.headers.get("original-content-type");
      if (origCt) {
        outHeaders.set("ORIGINAL-CONTENT-TYPE", origCt);
      }
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: outHeaders
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message || "Upstream fetch to MG failed" }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        }
      );
    }
  }
};
export {
  worker_default as default
};
