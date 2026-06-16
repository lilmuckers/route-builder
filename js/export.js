import { getSetting } from './storage.js';

const GIST_FILE_RE = /^path-tracer-route-.+\.json$/;

export async function listPathTracerGists(token) {
  const allGists = [];
  let page = 1;
  while (true) {
    const res = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
    const batch = await res.json();
    if (!batch.length) break;
    allGists.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  return allGists.filter(g =>
    Object.keys(g.files).some(f => GIST_FILE_RE.test(f))
  );
}

export async function fetchGistRoute(gist, token) {
  const filename = Object.keys(gist.files).find(f => GIST_FILE_RE.test(f));
  if (!filename) throw new Error('No route file in gist');
  const rawUrl = gist.files[filename].raw_url;
  const res = await fetch(rawUrl, {
    headers: { Authorization: `token ${token}` },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  return res.json();
}

export function exportJSON(route) {
  const json = JSON.stringify(route, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `route-${route.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportGist(route) {
  const token = await getSetting('githubToken');
  if (!token) throw new Error('No GitHub token saved. Add it in Settings.');

  const filename = `path-tracer-route-${route.id}.json`;
  const body = {
    description: `Path Tracer route: ${route.name}`,
    public: false,
    files: {
      [filename]: { content: JSON.stringify(route, null, 2) },
    },
  };

  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `GitHub API error ${res.status}`);
  }

  const data = await res.json();
  return data.html_url;
}
