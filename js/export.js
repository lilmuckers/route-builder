import { getSetting } from './storage.js';

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
