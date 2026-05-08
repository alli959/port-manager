let currentSort = { column: 'port', direction: 'asc' };
let currentFilter = { search: '', source: 'all' };
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

function getFilteredAndSortedData() {
  let filtered = [...portData];

  if (currentFilter.source !== 'all') {
    filtered = filtered.filter(p => p.source === currentFilter.source);
  }

  if (currentFilter.search) {
    const query = currentFilter.search.toLowerCase();
    filtered = filtered.filter(p =>
      String(p.port).includes(query) ||
      p.processName.toLowerCase().includes(query) ||
      p.localAddress.toLowerCase().includes(query) ||
      p.protocol.toLowerCase().includes(query) ||
      p.source.toLowerCase().includes(query) ||
      (p.pid && String(p.pid).includes(query))
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
    const canStop = entry.pid !== null && entry.processName !== '<unknown>';
    const addr = escapeHTML(entry.localAddress);

    return `<tr>
      <td>${entry.port}</td>
      <td>${entry.protocol}</td>
      <td>${addr}</td>
      <td>${entry.state}</td>
      <td>${pidDisplay}</td>
      <td class="${processClass}">${processDisplay}</td>
      <td><span class="badge badge-${entry.source.toLowerCase()}">${entry.source}</span></td>
      <td>
        <button class="btn btn-danger btn-sm stop-btn"
          ${canStop ? '' : 'disabled title="Cannot stop — unknown process"'}
          data-pid="${entry.pid}"
          data-source="${entry.source}"
          data-process="${escapeHTML(processDisplay)}"
          data-port="${entry.port}">Stop</button>
      </td>
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
