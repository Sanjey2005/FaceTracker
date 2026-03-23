export const API = 'http://localhost:8000';

export async function fetchStats() {
  const res = await fetch(`${API}/stats`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function fetchEvents() {
  const res = await fetch(`${API}/events`);
  if (!res.ok) throw new Error('Failed to fetch events');
  return res.json();
}

export async function fetchHourlyData(range = 'day') {
  const res = await fetch(`${API}/hourly${range === 'week' ? '?range=week' : ''}`);
  if (!res.ok) throw new Error('Failed to fetch hourly data');
  return res.json();
}

export async function fetchDemographics() {
  const res = await fetch(`${API}/demographics`);
  if (!res.ok) throw new Error('Failed to fetch demographics');
  return res.json();
}

export async function fetchFaces() {
  const res = await fetch(`${API}/faces`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchLiveFaces() {
  const res = await fetch(`${API}/faces/live`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchWatchlistAlerts() {
  const res = await fetch(`${API}/alerts?unacknowledged_only=true`);
  if (!res.ok) throw new Error('Failed to fetch watchlist alerts');
  return res.json();
}

export async function fetchWatchlist() {
  const res = await fetch(`${API}/watchlist`);
  if (!res.ok) throw new Error('Failed to fetch watchlist');
  return res.json();
}

export async function uploadStreamFile(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API}/stream/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Failed to upload stream file');
  return res.json();
}

export async function startStream(body) {
  const res = await fetch(`${API}/stream/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to start stream');
  return res;
}

export async function stopStream(cameraId) {
  const res = await fetch(`${API}/stream/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_id: cameraId }),
  });
  if (!res.ok) throw new Error('Failed to stop stream');
  return res;
}

export async function addWatchlistPerson(name, photoFile) {
  const form = new FormData();
  form.append('name', name);
  form.append('photo', photoFile);
  const res = await fetch(`${API}/watchlist/add`, { method: 'POST', body: form });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.detail || 'Failed to add person');
  }
  return res.json();
}

export async function removeWatchlistPerson(id) {
  const res = await fetch(`${API}/watchlist/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove watchlist person');
  return res;
}

export async function acknowledgeAlert(alertId) {
  const res = await fetch(`${API}/alerts/${alertId}/acknowledge`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to acknowledge alert');
  return res;
}
