import { formatDelta, copyPath, downloadBlob } from './utils.js';
import { parseClientLogFile } from './parser.js';
import { 
  categorizeZone, 
  groupEntriesIntoRuns, 
  processRunData, 
  calculateCampaignSplits 
} from './tracker.js';

// --- State ---
let parsedEntries = [];
let currentRuns = [];
let currentRunProcessed = [];

let currentSearchTerm = '';
let currentSortCol = 'timestamp';
let currentSortDir = 'asc';

let visibleCount = 50; 
const BATCH_SIZE = 50;
let observer = null;

// --- DOM References ---
const dropzone = document.getElementById('dropzone');
const locationNotes = document.getElementById('locationNotes');
const fileInput = document.getElementById('fileInput');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const dashboard = document.getElementById('dashboard');
const viewMode = document.getElementById('viewMode');
const dateSelect = document.getElementById('dateSelect');
const runSelect = document.getElementById('runSelect');
const resultsBody = document.querySelector('#resultsTable tbody');
const summaryBar = document.getElementById('summaryBar');
const standardView = document.getElementById('standardView');
const campaignView = document.getElementById('campaignView');
const campaignContent = document.getElementById('campaignContent');
const csvBtn = document.getElementById('csvBtn');
const searchInput = document.getElementById('searchInput');
const scrollSentinel = document.getElementById('scrollSentinel');
const scrollLoader = document.getElementById('scrollLoader');
const scrollStatus = document.getElementById('scrollStatus');
const gapInput = document.getElementById('gap');
const thresholdInput = document.getElementById('threshold');

// --- Initialization & Local Storage ---
gapInput.value = localStorage.getItem('poe_gap') || 30;
thresholdInput.value = localStorage.getItem('poe_threshold') || 6;

gapInput.addEventListener('change', () => {
  localStorage.setItem('poe_gap', gapInput.value);
  recalculate();
});
thresholdInput.addEventListener('change', () => {
  localStorage.setItem('poe_threshold', thresholdInput.value);
  recalculate();
});

// Event delegation for path copy clicks
document.addEventListener('click', (e) => {
  const copyEl = e.target.closest('.code-copy');
  if (copyEl) {
    const path = copyEl.dataset.path;
    if (path) copyPath(copyEl, path);
  }
});

// Drag & Drop Handlers
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFileSelect(e.target.files[0]);
});

// View mode switcher
viewMode.addEventListener('change', () => {
  if (viewMode.value === 'campaign') {
    standardView.style.display = 'none';
    campaignView.style.display = 'block';
    displayCampaignSplits();
  } else {
    standardView.style.display = 'block';
    campaignView.style.display = 'none';
    displayRun();
  }
});

// Table Filter & Sorting Handlers
searchInput.addEventListener('input', (e) => {
  currentSearchTerm = e.target.value;
  renderStandardTable(true);
});

document.getElementById('thTimestamp').addEventListener('click', () => handleSort('timestamp'));
document.getElementById('thDelta').addEventListener('click', () => handleSort('delta'));
document.getElementById('thZone').addEventListener('click', () => handleSort('zone'));

function handleSort(column) {
  if (currentSortCol === column) {
    currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortCol = column;
    currentSortDir = column === 'delta' ? 'desc' : 'asc';
  }
  renderStandardTable(true);
}

// File Processing
async function handleFileSelect(file) {
  progressBar.style.display = 'block';
  progressFill.style.width = '0%';

  parsedEntries = await parseClientLogFile(file, (percent) => {
    progressFill.style.width = percent + '%';
  });

  progressBar.style.display = 'none';

  if (!parsedEntries.length) {
    alert("No log entries found in this file.");
    return;
  }

  if (locationNotes) locationNotes.style.display = 'none';
  dashboard.style.display = 'block';
  populateDates();
}

function populateDates() {
  const dates = [...new Set(parsedEntries.map(e => e.dateStr))];
  dateSelect.innerHTML = dates.map(d => `<option value="${d}">${d}</option>`).join('') + '<option value="all">All Dates</option>';
  dateSelect.value = dates[dates.length - 1];
  recalculate();
}

dateSelect.addEventListener('change', recalculate);
runSelect.addEventListener('change', () => {
  if (viewMode.value === 'campaign') {
    displayCampaignSplits();
  } else {
    displayRun();
  }
});

function recalculate() {
  if (!parsedEntries.length) return;
  
  const selectedDate = dateSelect.value;
  const filtered = selectedDate === 'all' 
    ? parsedEntries 
    : parsedEntries.filter(e => e.dateStr === selectedDate);

  filtered.sort((a, b) => a.timestamp - b.timestamp);

  const gapMinutes = parseInt(gapInput.value, 10);
  currentRuns = groupEntriesIntoRuns(filtered, gapMinutes);

  runSelect.innerHTML = currentRuns.map((r, i) => {
    const start = r[0].timeStr;
    const end = r[r.length - 1].timeStr;
    const zoneCount = r.filter(e => e.type === 'zone').length;
    return `<option value="${i}">Run ${i + 1} (${start} - ${end}) [${zoneCount} zones]</option>`;
  }).join('') + '<option value="all">All Runs Combined</option>';

  runSelect.value = "0";

  if (viewMode.value === 'campaign') {
    displayCampaignSplits();
  } else {
    displayRun();
  }
}

function displayRun() {
  const runIdx = runSelect.value;
  const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
  if (!run || !run.length) { 
    resultsBody.innerHTML = ''; 
    summaryBar.innerHTML = '';
    updateScrollStatus(0, 0);
    return; 
  }

  const zoneEntries = run.filter(e => e.type === 'zone');
  if (!zoneEntries.length) { 
    resultsBody.innerHTML = ''; 
    summaryBar.innerHTML = '';
    updateScrollStatus(0, 0);
    return; 
  }

  const thresholdMinutes = parseInt(thresholdInput.value, 10);
  const { processed, categoryTotals, zoneTotals, totalTrackedSeconds } = processRunData(zoneEntries, thresholdMinutes);
  currentRunProcessed = processed;

  renderAnalytics(categoryTotals, zoneTotals, totalTrackedSeconds, zoneEntries);
  renderStandardTable(true);
}

// --- Infinite Scroll Setup ---
function initInfiniteScroll() {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      loadMoreRows();
    }
  }, { rootMargin: '200px' });

  if (scrollSentinel) {
    observer.observe(scrollSentinel);
  }
}

function loadMoreRows() {
  const filteredTotal = getFilteredAndSortedEntries().length;
  if (visibleCount < filteredTotal) {
    visibleCount += BATCH_SIZE;
    renderStandardTable(false);
  }
}

// Helper to apply search filtering and sorting
function getFilteredAndSortedEntries() {
  let filtered = currentRunProcessed;

  if (currentSearchTerm.trim() !== '') {
    const term = currentSearchTerm.toLowerCase();
    filtered = filtered.filter(e => e.zone.toLowerCase().includes(term));
  }

  filtered.sort((a, b) => {
    let valA, valB;
    if (currentSortCol === 'timestamp') {
      valA = a.originalIndex;
      valB = b.originalIndex;
    } else if (currentSortCol === 'delta') {
      valA = a.deltaMs || 0;
      valB = b.deltaMs || 0;
    } else if (currentSortCol === 'zone') {
      valA = a.zone.toLowerCase();
      valB = b.zone.toLowerCase();
    }

    if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return filtered;
}

function renderStandardTable(resetCount = true) {
  if (resetCount) {
    visibleCount = BATCH_SIZE;
  }

  if (!currentRunProcessed.length) {
    resultsBody.innerHTML = '';
    updateScrollStatus(0, 0);
    return;
  }

  const filtered = getFilteredAndSortedEntries();
  const totalEntries = filtered.length;
  const pageEntries = filtered.slice(0, visibleCount);

  // Update Sort Header Icons
  ['Timestamp', 'Delta', 'Zone'].forEach(col => {
    const iconEl = document.getElementById(`icon${col}`);
    if (iconEl) {
      if (currentSortCol === col.toLowerCase()) {
        iconEl.textContent = currentSortDir === 'asc' ? '▲' : '▼';
      } else {
        iconEl.textContent = '';
      }
    }
  });

  // Render Table Rows
  let html = '';
  pageEntries.forEach(entry => {
    const deltaStr = entry.deltaMs ? formatDelta(Math.floor(entry.deltaMs / 1000)) : '--';
    const isTown = entry.category === 'town';

    html += `
      <tr class="${entry.isLong ? 'long-stop' : ''}">
        <td>${entry.dateStr} ${entry.timeStr}</td>
        <td>${deltaStr}</td>
        <td>
          ${entry.zone}
          ${isTown ? '<span class="badge-town">TOWN</span>' : ''}
          ${entry.isLong ? '<span class="badge-danger">LONG STOP</span>' : ''}
        </td>
      </tr>
    `;
  });

  resultsBody.innerHTML = html;
  updateScrollStatus(pageEntries.length, totalEntries);
}

function updateScrollStatus(renderedCount, totalEntries) {
  if (!scrollStatus || !scrollLoader) return;

  if (totalEntries === 0) {
    scrollStatus.textContent = 'No matching entries found.';
    scrollLoader.style.display = 'none';
  } else if (renderedCount >= totalEntries) {
    scrollStatus.textContent = `Showing all ${totalEntries} entries.`;
    scrollLoader.style.display = 'none';
  } else {
    scrollStatus.textContent = `Showing ${renderedCount} of ${totalEntries} entries...`;
    scrollLoader.style.display = 'block';
  }
}

function renderAnalytics(categoryTotals, zoneTotals, totalSec, zoneEntries) {
  const total = totalSec || 1;
  const hideoutPct = ((categoryTotals.hideout / total) * 100).toFixed(1);
  const mapPct = ((categoryTotals.map / total) * 100).toFixed(1);
  const townPct = ((categoryTotals.town / total) * 100).toFixed(1);

  const sortedZones = Object.entries(zoneTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const spanMs = zoneEntries[zoneEntries.length - 1].timestamp - zoneEntries[0].timestamp;

  summaryBar.innerHTML = `
    <div style="width: 100%; display: flex; flex-direction: column; gap: 0.75rem;">
      <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 1rem; background: var(--bg); padding: 0.75rem; border-radius: 6px;">
        <span>Maps/Zones: <strong>${formatDelta(categoryTotals.map)} (${mapPct}%)</strong></span>
        <span>Hideout: <strong>${formatDelta(categoryTotals.hideout)} (${hideoutPct}%)</strong></span>
        <span>Town/Hubs: <strong>${formatDelta(categoryTotals.town)} (${townPct}%)</strong></span>
      </div>
      
      <div style="font-size: 0.85rem;">
        <strong style="color: var(--accent);">Top Zones by Time:</strong>
        <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.25rem;">
          ${sortedZones.map(([zone, sec]) => `
            <span>${zone}: <strong>${formatDelta(sec)}</strong> (${((sec / total) * 100).toFixed(0)}%)</span>
          `).join(' • ')}
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border); padding-top: 0.5rem; font-size: 0.85rem;">
        <span>Entries: <strong>${zoneEntries.length}</strong></span>
        <span>Run Duration: <strong>${formatDelta(Math.floor(spanMs / 1000))}</strong></span>
      </div>
    </div>
  `;
}

function displayCampaignSplits() {
  const runIdx = runSelect.value;
  const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
  if (!run || !run.length) {
    campaignContent.innerHTML = `<p class="empty-msg">No entries found for this run selection.</p>`;
    return;
  }

  const splits = calculateCampaignSplits(run);

  if (!splits.length) {
    campaignContent.innerHTML = `<p class="empty-msg">No sequential campaign Act transitions found in this selected run.</p>`;
    return;
  }

  const totalTime = splits.length > 1 ? splits[splits.length - 1].totalSec : 0;

  let html = `
    <div class="campaign-title">Campaign Act Split Report</div>
    <div class="campaign-subtitle">Total Campaign Duration: <strong>${formatDelta(totalTime)}</strong></div>
    <table>
      <thead>
        <tr>
          <th>Act / Stage</th>
          <th>Character Level</th>
          <th>Act Split</th>
          <th>Total Elapsed</th>
          <th>Entry Timestamp</th>
        </tr>
      </thead>
      <tbody>
  `;

  splits.forEach((s, i) => {
    const splitFormatted = i === 0 ? '--' : formatDelta(s.splitSec);
    const label = s.act === "Maps" ? "Endgame Maps" : `Act ${s.act}`;

    html += `
      <tr>
        <td><strong>${label}</strong></td>
        <td>Level ${s.level}</td>
        <td>${splitFormatted}</td>
        <td>${formatDelta(s.totalSec)}</td>
        <td>${s.dateStr} ${s.timeStr}</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  campaignContent.innerHTML = html;
}

// CSV Export Router
csvBtn.addEventListener('click', () => {
  if (viewMode.value === 'campaign') {
    exportCampaignCSV();
  } else {
    exportStandardCSV();
  }
});

function exportStandardCSV() {
  const runIdx = runSelect.value;
  const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
  if (!run || !run.length) return;

  const zoneEntries = run.filter(e => e.type === 'zone');
  const thresholdMs = parseInt(thresholdInput.value, 10) * 60 * 1000;
  let csv = "timestamp,delta_seconds,delta_formatted,long_stop,zone,category\n";
  let prevTime = null;

  zoneEntries.forEach(entry => {
    const deltaMs = prevTime ? (entry.timestamp - prevTime) : 0;
    const deltaSec = Math.floor(deltaMs / 1000);
    const isLong = prevTime && deltaMs > thresholdMs;
    const cat = categorizeZone(entry.zone);

    csv += `"${entry.dateStr} ${entry.timeStr}",${deltaSec},"${formatDelta(deltaSec)}","${isLong ? 'YES' : ''}","${entry.zone.replace(/"/g, '""')}","${cat}"\n`;
    prevTime = entry.timestamp;
  });

  downloadBlob(csv, `poe_session_${dateSelect.value}.csv`);
}

function exportCampaignCSV() {
  const runIdx = runSelect.value;
  const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
  if (!run || !run.length) return;

  const splits = calculateCampaignSplits(run);
  if (!splits.length) return;

  let csv = "act,level,split_seconds,split_formatted,total_seconds,total_formatted,timestamp\n";
  splits.forEach(s => {
    csv += `"${s.act}",${s.level},${s.splitSec},"${formatDelta(s.splitSec)}",${s.totalSec},"${formatDelta(s.totalSec)}","${s.dateStr} ${s.timeStr}"\n`;
  });

  downloadBlob(csv, `poe_campaign_splits_${dateSelect.value}.csv`);
}

// Initialize Observer on boot
initInfiniteScroll();