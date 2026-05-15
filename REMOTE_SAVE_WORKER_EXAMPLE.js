export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,x-api-key"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (env.WORKER_API_KEY) {
      const key = request.headers.get("x-api-key") || "";
      if (key !== env.WORKER_API_KEY) {
        return json({ error: "unauthorized" }, 401, cors);
      }
    }

    const owner = "infochibafukushi-dotcom";
    const repo = "kaigo-quiz";
    const path = "questions.json";
    const branch = env.GITHUB_BRANCH || "main";

    if (!env.GITHUB_TOKEN) return json({ error: "missing GITHUB_TOKEN" }, 500, cors);

    if (request.method === "GET") {
      const content = await getFile(env.GITHUB_TOKEN, owner, repo, path, branch);
      return json(content.json, 200, cors);
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body || !body.db) return json({ error: "invalid payload" }, 400, cors);

      const current = await getFile(env.GITHUB_TOKEN, owner, repo, path, branch);
      const updated = await putFile(env.GITHUB_TOKEN, owner, repo, path, branch, current.sha, body.db);

      return json({ ok: true, scope: body.scope || "all", commit: updated.commit?.sha || null }, 200, cors);
    }

    return new Response("method not allowed", { status: 405, headers: cors });
  }
};

async function getFile(token, owner, repo, path, branch) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GET contents failed: HTTP ${res.status}`);
  const data = await res.json();
  const text = atob(data.content.replace(/\n/g, ""));
  return { sha: data.sha, json: JSON.parse(text) };
}

async function putFile(token, owner, repo, path, branch, sha, db) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(db, null, 2) + "\n")));
  const payload = {
    message: `chore: update questions.json via admin (${new Date().toISOString()})`,
    content,
    sha,
    branch
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PUT contents failed: HTTP ${res.status} ${err}`);
  }
  return await res.json();
}

function ghHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "kaigo-quiz-worker"
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
