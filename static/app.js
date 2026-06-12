const statusText = document.getElementById('statusText');
const sourcePathInput = document.getElementById('sourcePath');
const targetPathInput = document.getElementById('targetPath');
const browseList = document.getElementById('browseList');
const breadcrumbs = document.getElementById('breadcrumbs');
const driveList = document.getElementById('driveList');
let currentBrowsePath = '';

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    statusText.textContent = formatStatus(data);
    if (data.config?.target) {
      targetPathInput.value = data.config.target;
    }
    if (data.config?.sources?.length) {
      sourcePathInput.value = data.config.sources[0];
    }
    await loadDirectory('');
    await loadDrives();
  } catch (error) {
    statusText.textContent = 'Fehler beim Laden des Status.\n' + error;
  }
}

async function loadDrives() {
  try {
    const res = await fetch('/api/drives');
    const data = await res.json();
    driveList.innerHTML = '';
    if (!data.drives?.length) {
      driveList.textContent = 'Keine Laufwerke gefunden.';
      return;
    }
    data.drives.forEach((drive) => {
      const card = document.createElement('div');
      card.className = 'drive-card';

      const title = document.createElement('div');
      title.className = 'drive-title';
      title.innerHTML = `<strong>${drive.mountpoint}</strong><br><span>${drive.device} • ${drive.fstype}</span>`;

      const actions = document.createElement('div');
      actions.className = 'drive-actions';

      const sourceButton = document.createElement('button');
      sourceButton.type = 'button';
      sourceButton.className = 'drive-button';
      sourceButton.textContent = 'Als Quelle';
      sourceButton.addEventListener('click', () => selectSource(drive.mountpoint));

      const targetButton = document.createElement('button');
      targetButton.type = 'button';
      targetButton.className = 'drive-button';
      targetButton.textContent = 'Als Ziel';
      targetButton.addEventListener('click', () => selectTarget(drive.mountpoint));

      actions.appendChild(sourceButton);
      actions.appendChild(targetButton);
      card.appendChild(title);
      card.appendChild(actions);
      driveList.appendChild(card);
    });
  } catch (error) {
    driveList.textContent = 'Fehler beim Laden der Laufwerke.';
    console.error(error);
  }
}

function selectSource(path) {
  sourcePathInput.value = path;
  statusText.textContent = `Quelle ausgewählt: ${path}`;
  loadDirectory(path);
}

function selectTarget(path) {
  targetPathInput.value = path;
  statusText.textContent = `Ziel ausgewählt: ${path}`;
  loadDirectory(path);
}

async function clearSource() {
  sourcePathInput.value = '';
  statusText.textContent = 'Quelle entfernt.';
  const currentConfig = await action('/api/config');
  const payload = {
    ...currentConfig,
    sources: [],
  };
  await action('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await fetchStatus();
}

async function clearTarget() {
  targetPathInput.value = '';
  statusText.textContent = 'Ziel entfernt.';
  const currentConfig = await action('/api/config');
  const payload = {
    ...currentConfig,
    target: '',
  };
  await action('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await fetchStatus();
}

function normalizePath(path) {
  if (!path) return '';
  return path.replace(/\\/g, '/');
}

function buildParentPath(path) {
  if (!path) return '';

  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const driveMatch = normalized.match(/^([A-Za-z]:)(?:\/|$)(.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1];
    const rest = driveMatch[2];
    if (!rest) {
      return '';
    }
    const parts = rest.split('/').filter(Boolean);
    parts.pop();
    if (!parts.length) {
      return `${drive}\\`;
    }
    return `${drive}\\${parts.join('\\')}`;
  }

  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  if (!parts.length) {
    return '';
  }
  return '/' + parts.join('/');
}

function formatStatus(data) {
  const lines = [];
  // Host and platform are no longer provided by the API
  // (removed from server-side for privacy); skip displaying them.
  lines.push(`Uptime: ${data.uptime_h} h`);
  lines.push(`Backup-Ziel: ${data.target_path || 'nicht gesetzt'}`);
  lines.push(`Ziel verbunden: ${data.target_connected ? 'Ja' : 'Nein'}`);
  if (data.target_info) {
    lines.push(`Speicher: ${data.target_info.free_gb} GB frei von ${data.target_info.total_gb} GB (${data.target_info.percent}%)`);
  }
  lines.push('');
  lines.push('Aktueller Job:');
  if (data.current?.status) {
    lines.push(`  Status: ${data.current.status}`);
    lines.push(`  Fortschritt: ${data.current.progress || 0}%`);
    if (data.current.log?.length) {
      lines.push('  Letzte Einträge:');
      lines.push(...data.current.log.slice(-4).map((line) => `    ${line}`));
    }
  } else {
    lines.push('  Kein laufender Job');
  }
  lines.push('');
  lines.push('Letztes Backup:');
  if (data.last_backup) {
    lines.push(`  Status: ${data.last_backup.status}`);
    lines.push(`  Gestartet: ${data.last_backup.started}`);
    lines.push(`  Beendet: ${data.last_backup.finished}`);
    if (data.last_backup.snapshot) {
      lines.push(`  Snapshot: ${data.last_backup.snapshot}`);
    }
  } else {
    lines.push('  Keine Historie vorhanden.');
  }
  return lines.join('\n');
}

async function action(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${body}`);
    }
    return await res.json();
  } catch (error) {
    statusText.textContent = 'Fehler: ' + error;
    throw error;
  }
}

function renderBreadcrumbs(path) {
  const normalized = path ? path.replace(/\\/g, '/') : '';
  const parts = normalized ? normalized.split('/').filter(Boolean) : [];
  breadcrumbs.innerHTML = '';
  const rootButton = document.createElement('button');
  rootButton.type = 'button';
  rootButton.className = 'breadcrumb-item';
  rootButton.textContent = path ? 'Root' : 'Aktueller Speicherort';
  rootButton.addEventListener('click', () => loadDirectory(''));
  breadcrumbs.appendChild(rootButton);

  let cur = '';
  const isWindowsDrive = /^[A-Za-z]:$/.test(parts[0]);
  parts.forEach((part, index) => {
    if (index === 0 && isWindowsDrive) {
      cur = `${part}\\`;
    } else {
      cur += (cur && !cur.endsWith('\\') ? '\\' : '') + part;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'breadcrumb-item';
    button.textContent = part;
    button.addEventListener('click', () => loadDirectory(cur));
    breadcrumbs.appendChild(button);
  });
}

async function loadDirectory(path) {
  currentBrowsePath = path;
  try {
    const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
    const res = await fetch(url);
    const data = await res.json();
    renderBreadcrumbs(data.path || '');
    browseList.innerHTML = '';
    if (data.entries.length === 0) {
      browseList.textContent = 'Keine Verzeichnisse gefunden.';
      return;
    }
    data.entries.forEach((entry) => {
      if (!entry.is_dir) return;
      const card = document.createElement('div');
      card.className = 'browse-entry';

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'browse-item';
      label.textContent = entry.name;
      label.addEventListener('click', () => {
        loadDirectory(entry.path);
      });

      card.appendChild(label);
      browseList.appendChild(card);
    });
  } catch (error) {
    browseList.textContent = 'Fehler beim Laden des Ordnerverzeichnisses.';
    console.error(error);
  }
}

document.getElementById('startBackup').addEventListener('click', async () => {
  if (!sourcePathInput.value.trim() || !targetPathInput.value.trim()) {
    statusText.textContent = 'Quelle und Ziel müssen ausgewählt werden.';
    return;
  }
  statusText.textContent = 'Backup wird gestartet...';
  const currentConfig = await action('/api/config');
  const payload = {
    ...currentConfig,
    sources: [sourcePathInput.value.trim()],
    target: targetPathInput.value.trim(),
  };
  await action('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await action('/api/backup/start', { method: 'POST' });
  await fetchStatus();
});

document.getElementById('checkStatus').addEventListener('click', fetchStatus);

if (document.getElementById('clearSource')) {
  document.getElementById('clearSource').addEventListener('click', clearSource);
}
if (document.getElementById('clearTarget')) {
  document.getElementById('clearTarget').addEventListener('click', clearTarget);
}
if (document.getElementById('goUp')) {
  document.getElementById('goUp').addEventListener('click', () => {
    loadDirectory(buildParentPath(currentBrowsePath));
  });
}
if (document.getElementById('selectCurrentSource')) {
  document.getElementById('selectCurrentSource').addEventListener('click', () => {
    if (!currentBrowsePath) {
      statusText.textContent = 'Navigiere zuerst zu einem Ordner.';
      return;
    }
    sourcePathInput.value = currentBrowsePath;
    statusText.textContent = `Quelle ausgewählt: ${currentBrowsePath}`;
  });
}
if (document.getElementById('selectCurrentTarget')) {
  document.getElementById('selectCurrentTarget').addEventListener('click', () => {
    if (!currentBrowsePath) {
      statusText.textContent = 'Navigiere zuerst zu einem Ordner.';
      return;
    }
    targetPathInput.value = currentBrowsePath;
    statusText.textContent = `Ziel ausgewählt: ${currentBrowsePath}`;
  });
}

document.getElementById('saveSource').addEventListener('click', async () => {
  if (!sourcePathInput.value.trim()) {
    statusText.textContent = 'Wähle zuerst eine Quelle aus.';
    return;
  }
  statusText.textContent = 'Speichere Quellort...';
  const currentConfig = await action('/api/config');
  const payload = {
    ...currentConfig,
    sources: [sourcePathInput.value.trim()],
  };
  await action('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await fetchStatus();
});

document.getElementById('saveTarget').addEventListener('click', async () => {
  if (!targetPathInput.value.trim()) {
    statusText.textContent = 'Wähle zuerst ein Ziel aus.';
    return;
  }
  statusText.textContent = 'Speichere Backup-Ziel...';
  const currentConfig = await action('/api/config');
  const payload = {
    ...currentConfig,
    target: targetPathInput.value.trim(),
  };
  await action('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await fetchStatus();
});

document.getElementById('abortBackup').addEventListener('click', async () => {
  try {
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    
    if (!statusData.current?.status || statusData.current.status !== 'running') {
      statusText.textContent = 'Kein laufendes Backup zum Abbrechen.';
      return;
    }
    
    statusText.textContent = 'Sende Abbruch-Anfrage...';
    await action('/api/backup/abort', { method: 'POST' });
    await fetchStatus();
  } catch (error) {
    statusText.textContent = 'Fehler: ' + error;
  }
});

function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const clockElement = document.getElementById('dashboardClock');
  if (clockElement) {
    clockElement.textContent = `${hours}:${minutes}:${seconds}`;
  }
}

function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  startClock();
  fetchStatus();
});
