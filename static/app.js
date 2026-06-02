const statusText = document.getElementById('statusText');
const targetPathInput = document.getElementById('targetPath');
const browseList = document.getElementById('browseList');
const breadcrumbs = document.getElementById('breadcrumbs');
let currentBrowsePath = '';

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    statusText.textContent = formatStatus(data);
    if (data.config?.target) {
      targetPathInput.value = data.config.target;
    }
    await loadDirectory('');
  } catch (error) {
    statusText.textContent = 'Fehler beim Laden des Status.\n' + error;
  }
}

function formatStatus(data) {
  const lines = [];
  lines.push(`Host: ${data.host}`);
  lines.push(`Platform: ${data.platform}`);
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
  const parts = path ? path.split(/\\|\//).filter(Boolean) : [];
  let prefix = path && path.startsWith('/') ? '/' : '';
  breadcrumbs.innerHTML = '';
  const rootButton = document.createElement('button');
  rootButton.type = 'button';
  rootButton.className = 'breadcrumb-item';
  rootButton.textContent = path ? 'Root' : 'Aktueller Speicherort';
  rootButton.addEventListener('click', () => loadDirectory(''));
  breadcrumbs.appendChild(rootButton);

  let cur = prefix;
  parts.forEach((part, index) => {
    cur += part;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'breadcrumb-item';
    button.textContent = part;
    button.addEventListener('click', () => loadDirectory(cur));
    breadcrumbs.appendChild(button);
    cur += '/';
  });
}

function selectTarget(path) {
  targetPathInput.value = path;
  statusText.textContent = `Ziel ausgewählt: ${path}`;
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
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'browse-item';
      item.textContent = entry.name;
      item.addEventListener('click', () => {
        const newPath = entry.path;
        selectTarget(newPath);
        loadDirectory(newPath);
      });
      browseList.appendChild(item);
    });
  } catch (error) {
    browseList.textContent = 'Fehler beim Laden des Ordnerverzeichnisses.';
    console.error(error);
  }
}

document.getElementById('startBackup').addEventListener('click', async () => {
  statusText.textContent = 'Backup wird gestartet...';
  await action('/api/backup/start', { method: 'POST' });
  await fetchStatus();
});

document.getElementById('checkStatus').addEventListener('click', fetchStatus);

document.getElementById('saveTarget').addEventListener('click', async () => {
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
  statusText.textContent = 'Sende Abbruch-Anfrage...';
  await action('/api/backup/abort', { method: 'POST' });
  await fetchStatus();
});

fetchStatus();
