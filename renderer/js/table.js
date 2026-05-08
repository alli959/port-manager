let currentSort = { column: 'port', direction: 'asc' };
let currentFilter = { search: '', source: 'all', type: 'all' };
let portData = [];

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setPortData(data) {
  portData = data;
  renderTable();
}

function getPortData() {
  return portData;
}

function getFilteredAndSortedData() {
  let filtered = [...portData];

  if (currentFilter.source !== 'all') {
    filtered = filtered.filter(p => p.source === currentFilter.source);
  }

  if (currentFilter.type !== 'all') {
    filtered = filtered.filter(p => p.type === currentFilter.type);
  }

  if (currentFilter.search) {
    const query = currentFilter.search.toLowerCase();
    filtered = filtered.filter(p =>
      String(p.port).includes(query) ||
      p.processName.toLowerCase().includes(query) ||
      p.localAddress.toLowerCase().includes(query) ||
      p.protocol.toLowerCase().includes(query) ||
      p.source.toLowerCase().includes(query) ||
      (p.pid && String(p.pid).includes(query)) ||
      (p.mapping && p.mapping.toLowerCase().includes(query)) ||
      (p.containerName && p.containerName.toLowerCase().includes(query)) ||
      (p.containerImage && p.containerImage.toLowerCase().includes(query)) ||
      (p.tunnelTarget && p.tunnelTarget.toLowerCase().includes(query))
    );
  }

  filtered.sort((a, b) => {
    let aVal = a[currentSort.column];
    let bVal = b[currentSort.column];

    if (aVal === null || aVal === undefined) aVal = '';
    if (bVal === null || bVal === undefined) bVal = '';

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
    }

    aVal = String(aVal).toLowerCase();
    bVal = String(bVal).toLowerCase();
    const cmp = aVal.localeCompare(bVal);
    return currentSort.direction === 'asc' ? cmp : -cmp;
  });

  return filtered;
}

function getActionButton(entry) {
  const source = entry.source;
  let label, canAct;

  if (source === 'Docker') {
    label = 'Stop Container';
    canAct = !!entry.containerId;
  } else if (source === 'SSH' || source === 'Kubernetes') {
    label = 'Disconnect';
    canAct = entry.pid !== null;
  } else if (source === 'PortProxy') {
    label = 'Remove Rule';
    canAct = true;
  } else {
    label = 'Stop';
    canAct = entry.pid !== null && entry.processName !== '<unknown>';
  }

  const dataAttrs = `data-pid="${entry.pid}" data-source="${source}" data-process="${escapeHTML(entry.processName)}" data-port="${entry.port}"` +
    (entry.containerId ? ` data-container-id="${escapeHTML(entry.containerId)}"` : '') +
    (entry.localAddress ? ` data-listen-address="${escapeHTML(entry.localAddress)}"` : '') +
    (entry.proxyType ? ` data-proxy-type="${entry.proxyType}"` : '') +
    (entry.mapping ? ` data-mapping="${escapeHTML(entry.mapping)}"` : '');

  return `<button class="btn btn-danger btn-sm stop-btn"
    ${canAct ? '' : 'disabled title="Cannot stop — unknown process"'}
    ${dataAttrs}>${label}</button>`;
}

function renderTable() {
  const tbody = document.getElementById('port-table-body');
  const emptyState = document.getElementById('empty-state');
  const loadingState = document.getElementById('loading-state');

  loadingState.style.display = 'none';

  const data = getFilteredAndSortedData();

  if (data.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  tbody.innerHTML = data.map(entry => {
    const pidDisplay = entry.pid !== null ? entry.pid : '—';
    const processClass = entry.processName === '<unknown>' ? 'text-muted' : '';
    const processDisplay = entry.processName === '<unknown>' ? 'Unknown' : escapeHTML(entry.processName);
    const addr = escapeHTML(entry.localAddress);
    const mappingDisplay = entry.mapping ? escapeHTML(entry.mapping) : '—';

    return `<tr>
      <td>${entry.port}</td>
      <td class="${entry.mapping ? 'mapping-cell' : ''}">${mappingDisplay}</td>
      <td>${entry.protocol}</td>
      <td>${addr}</td>
      <td>${entry.state}</td>
      <td>${pidDisplay}</td>
      <td class="${processClass}">${processDisplay}</td>
      <td><span class="badge badge-${entry.source.toLowerCase()}">${entry.source}</span></td>
      <td>${getActionButton(entry)}</td>
    </tr>`;
  }).join('');
}

function setSort(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'asc';
  }
  updateSortIndicators();
  renderTable();
}

function updateSortIndicators() {
  document.querySelectorAll('.sortable').forEach(th => {
    const indicator = th.querySelector('.sort-indicator');
    if (th.dataset.column === currentSort.column) {
      indicator.textContent = currentSort.direction === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('active-sort');
    } else {
      indicator.textContent = '';
      th.classList.remove('active-sort');
    }
  });
}

function setFilter(filter) {
  Object.assign(currentFilter, filter);
  renderTable();
}

document.addEventListener('DOMContentLoaded', () => {
  updateSortIndicators();
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => setSort(th.dataset.column));
  });
});
