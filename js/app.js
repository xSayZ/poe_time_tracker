import { APP_VERSION, APP_NAME } from './version.js';
import { formatDelta, copyPath, downloadBlob } from './utils.js';
import { parseClientLogFile } from './parser.js';
import { 
  categorizeZone, 
  groupEntriesIntoRuns, 
  processRunData, 
  calculateCampaignSplits 
} from './tracker.js';

function initVersion() {
  document.title = `${APP_NAME} ${APP_VERSION}`;
  const versionTag = document.getElementById('versionTag');
  if (versionTag) {
    versionTag.textContent = APP_VERSION;
  }
}

initVersion();

// --- State ---
let rawLogText = '';
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
const resultsBody = document.getElementById('resultsBody');
const summaryBar = document.getElementById('summaryBar');
const standardView = document.getElementById('standardView');
const campaignView = document.getElementById('campaignView');
const campaignContent = document.getElementById('campaignContent');
const csvBtn = document.getElementById('csvBtn');
const markdownBtn = document.getElementById('markdownBtn');
const searchInput = document.getElementById('searchInput');
const scrollSentinel = document.getElementById('scrollSentinel');
const scrollLoader = document.getElementById('scrollLoader');
const scrollStatus = document.getElementById('scrollStatus');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const gapInput = document.getElementById('gap');
const thresholdInput = document.getElementById('threshold');

// Local Storage initialization
if (gapInput) gapInput.value = localStorage.getItem('poe_gap') || 30;
if (thresholdInput) thresholdInput.value = localStorage.getItem('poe_threshold') || 6;

if (gapInput) {
  gapInput.addEventListener('change', () => {
    localStorage.setItem('poe_gap', gapInput.value);
    recalculate();
  });
}

if (thresholdInput) {
  thresholdInput.addEventListener('change', () => {
    localStorage.setItem('poe_threshold', thresholdInput.value);
    recalculate();
  });
}

// Event Delegation for Copy & Keyboard Action
document.addEventListener('click', (e) => {
  const copyEl = e.target.closest('.code-copy');
  if (copyEl) {
    const path = copyEl.dataset.path;
    if (path) copyPath(copyEl, path);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const copyEl = e.target.closest('.code-copy');
    if (copyEl) {
      e.preventDefault();
      const path = copyEl.dataset.path;
      if (path) copyPath(copyEl, path);
    }
  }
});

// Dropzone Drag/Drop & Keyboard Access
if (dropzone) {
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener('dragover', (e) => { 
    e.preventDefault(); 
    dropzone.classList.add('dragover'); 
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
  });
}

if (fileInput) {
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) handleFileSelect(e.target.files[0]);
  });
}

// View mode switcher
if (viewMode) {
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
}

// Search Filtering
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    currentSearchTerm = e.target.value;
    renderStandardTable(true);
  });
}

// Table Header Sorting
const thTimestamp = document.getElementById('thTimestamp');
const thDelta = document.getElementById('thDelta');
const thZone = document.getElementById('thZone');

if (thTimestamp) thTimestamp.addEventListener('click', () => handleSort('timestamp'));
if (thDelta) thDelta.addEventListener('click', () => handleSort('delta'));
if (thZone) thZone.addEventListener('click', () => handleSort('zone'));

if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', () => loadMoreRows());
}

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
  if (progressBar) progressBar.style.display = 'block';
  if (progressFill) progressFill.style.width = '0%';

  rawLogText = await file.text();

  parsedEntries = await parseClientLogFile(file, (percent) => {
    if (progressFill) {
      progressFill.style.width = percent + '%';
      progressBar.setAttribute('aria-valuenow', Math.round(percent));
    }
  });

  if (progressBar) progressBar.style.display = 'none';

  if (!parsedEntries.length) {
    alert("No log entries found in this file.");
    return;
  }

  if (locationNotes) locationNotes.style.display = 'none';
  if (dashboard) dashboard.style.display = 'block';
  
  populateDates();
  initInfiniteScroll();
}

function populateDates() {
  const dates = [...new Set(parsedEntries.map(e => e.dateStr))];
  if (dateSelect) {
    dateSelect.innerHTML = dates.map(d => `<option value="${d}">${d}</option>`).join('') + '<option value="all">All Dates</option>';
    dateSelect.value = dates[dates.length - 1];
  }
  recalculate();
}

if (dateSelect) dateSelect.addEventListener('change', recalculate);
if (runSelect) {
  runSelect.addEventListener('change', () => {
    if (viewMode.value === 'campaign') {
      displayCampaignSplits();
    } else {
      displayRun();
    }
  });
}

function recalculate() {
  if (!parsedEntries.length) return;
  
  const selectedDate = dateSelect ? dateSelect.value : 'all';
  const filtered = selectedDate === 'all' 
    ? parsedEntries 
    : parsedEntries.filter(e => e.dateStr === selectedDate);

  filtered.sort((a, b) => a.timestamp - b.timestamp);

  const gapMinutes = parseInt(gapInput ? gapInput.value : 30, 10);
  currentRuns = groupEntriesIntoRuns(filtered, gapMinutes);

  if (runSelect) {
    runSelect.innerHTML = currentRuns.map((r, i) => {
      const start = r[0].timeStr;
      const end = r[r.length - 1].timeStr;
      const zoneCount = r.filter(e => e.type === 'zone').length;
      return `<option value="${i}">Run ${i + 1} (${start} - ${end}) [${zoneCount} zones]</option>`;
    }).join('') + '<option value="all">All Runs Combined</option>';

    runSelect.value = "0";
  }

  if (viewMode && viewMode.value === 'campaign') {
    displayCampaignSplits();
  } else {
    displayRun();
  }
}

function displayRun() {
  const runIdx = runSelect ? runSelect.value : "0";
  const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
  
  if (!run || !run.length) { 
    if (resultsBody) resultsBody.innerHTML = ''; 
    if (summaryBar) summaryBar.innerHTML = '';
    updateScrollStatus(0, 0);
    return; 
  }

  const zoneEntries = run.filter(e => e.type === 'zone');
  if (!zoneEntries.length) { 
    if (resultsBody) resultsBody.innerHTML = ''; 
    if (summaryBar) summaryBar.innerHTML = '';
    updateScrollStatus(0, 0);
    return; 
  }

  const thresholdMinutes = parseInt(thresholdInput ? thresholdInput.value : 6, 10);
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
  }, { root: null, rootMargin: '300px', threshold: 0.1 });

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

function getFilteredAndSortedEntries() {
  let filtered = [...currentRunProcessed];

  if (currentSearchTerm.trim() !== '') {
    const term = currentSearchTerm.toLowerCase();
    filtered = filtered.filter(e => e.zone.toLowerCase().includes(term));
  }

  filtered.sort((a, b) => {
    let valA, valB;
    if (currentSortCol === 'timestamp') {
      valA = a.timestamp || 0;
      valB = b.timestamp || 0;
    } else if (currentSortCol === 'delta') {
      valA = a.deltaMs || 0;
      valB = b.deltaMs || 0;
    } else if (currentSortCol === 'zone') {
      valA = (a.zone || '').toLowerCase();
      valB = (b.zone || '').toLowerCase();
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
    if (resultsBody) resultsBody.innerHTML = '';
    updateScrollStatus(0, 0);
    return;
  }

  const filtered = getFilteredAndSortedEntries();
  const totalEntries = filtered.length;
  const pageEntries = filtered.slice(0, visibleCount);

  // Accessible ARIA Sort Status Update
  const cols = [
    { name: 'Timestamp', el: thTimestamp, icon: 'iconTimestamp' },
    { name: 'Delta', el: thDelta, icon: 'iconDelta' },
    { name: 'Zone', el: thZone, icon: 'iconZone' }
  ];

  cols.forEach(col => {
    const iconEl = document.getElementById(col.icon);
    const key = col.name.toLowerCase();
    if (col.el) {
      if (currentSortCol === key) {
        const dirAttr = currentSortDir === 'asc' ? 'ascending' : 'descending';
        col.el.setAttribute('aria-sort', dirAttr);
        if (iconEl) iconEl.textContent = currentSortDir === 'asc' ? ' ▲' : ' ▼';
      } else {
        col.el.setAttribute('aria-sort', 'none');
        if (iconEl) iconEl.textContent = '';
      }
    }
  });

  let html = '';
  pageEntries.forEach(entry => {
    const deltaStr = entry.deltaMs ? formatDelta(Math.floor(entry.deltaMs / 1000)) : '--';
    const isTown = entry.category === 'town';

    html += `
      <tr class="${entry.isLong ? 'row-long-stop' : ''}">
        <td>${entry.dateStr} ${entry.timeStr}</td>
        <td>${deltaStr}</td>
        <td>
          ${entry.zone}
          ${isTown ? '<span class="badge badge-town"><span aria-hidden="true"></span>TOWN</span>' : ''}
          ${entry.isLong ? '<span class="badge badge-danger"><span aria-hidden="true">⏸ </span>LONG STOP</span>' : ''}
        </td>
      </tr>
    `;
  });

  if (resultsBody) resultsBody.innerHTML = html;
  updateScrollStatus(pageEntries.length, totalEntries);
}

function updateScrollStatus(renderedCount, totalEntries) {
  if (!scrollStatus) return;

  if (totalEntries === 0) {
    scrollStatus.textContent = 'No matching entries found.';
    if (scrollLoader) scrollLoader.style.display = 'none';
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  } else if (renderedCount >= totalEntries) {
    scrollStatus.textContent = `Showing all ${totalEntries} entries.`;
    if (scrollLoader) scrollLoader.style.display = 'none';
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  } else {
    scrollStatus.textContent = `Showing ${renderedCount} of ${totalEntries} entries.`;
    if (scrollLoader) scrollLoader.style.display = 'inline-block';
    if (loadMoreBtn) loadMoreBtn.style.display = 'inline-block';
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

  if (summaryBar) {
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
}

function displayCampaignSplits() {
  const runIdx = runSelect ? runSelect.value : "0";
  const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
  if (!run || !run.length) {
    if (campaignContent) campaignContent.innerHTML = `<p class="empty-msg">No entries found for this run selection.</p>`;
    return;
  }

  const splits = calculateCampaignSplits(run);

  if (!splits.length) {
    if (campaignContent) campaignContent.innerHTML = `<p class="empty-msg">No sequential campaign Act transitions found in this selected run.</p>`;
    return;
  }

  const totalTime = splits.length > 1 ? splits[splits.length - 1].totalSec : 0;

  let html = `
    <div class="campaign-title">Campaign Act Split Report</div>
    <div class="campaign-subtitle">Total Campaign Duration: <strong>${formatDelta(totalTime)}</strong></div>
    <table aria-label="Campaign Act Split Breakdown">
      <thead>
        <tr>
          <th scope="col">Act / Stage</th>
          <th scope="col">Character Level</th>
          <th scope="col">Act Split</th>
          <th scope="col">Total Elapsed</th>
          <th scope="col">Entry Timestamp</th>
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
  if (campaignContent) campaignContent.innerHTML = html;
}

// Markdown Export Logic
function generateCampaignMarkdown(splits) {
  if (!splits || !splits.length) return '';

  const numericActs = splits.map(s => s.act).filter(a => a !== 'Maps');
  const lastAct = numericActs.length ? numericActs[numericActs.length - 1] : '1';
  const reachedMaps = splits.some(s => s.act === 'Maps');

  let titleSpan = `Act 1 - Act ${lastAct}`;
  if (reachedMaps) titleSpan += ' (Endgame Maps)';

  const totalTime = splits.length > 1 ? splits[splits.length - 1].totalSec : 0;

  let md = `### Path of Exile Campaign Progression (${titleSpan})\n`;
  md += `**Total Duration:** \`${formatDelta(totalTime)}\` | **Date:** \`${splits[0].dateStr}\`\n\n`;
  
  md += "```\n";
  md += "Act / Stage   Level   Split Time   Total Elapsed\n";
  md += "------------------------------------------------\n";

  splits.forEach((s, i) => {
    const splitFormatted = i === 0 ? '--' : formatDelta(s.splitSec);
    const label = s.act === "Maps" ? "Endgame Maps" : `Act ${s.act}`;
    
    const col1 = label.padEnd(14, ' ');
    const col2 = `Lv. ${s.level}`.padEnd(8, ' ');
    const col3 = splitFormatted.padEnd(13, ' ');
    const col4 = formatDelta(s.totalSec);
    
    md += `${col1}${col2}${col3}${col4}\n`;
  });

  md += "```\n";
  md += `*Generated with ${APP_NAME} ${APP_VERSION}*`;
  return md;
}

if (markdownBtn) {
  markdownBtn.addEventListener('click', async () => {
    const runIdx = runSelect ? runSelect.value : "0";
    const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
    if (!run || !run.length) return;

    const splits = calculateCampaignSplits(run);
    if (!splits.length) {
      alert("No sequential campaign splits found in this run to copy.");
      return;
    }

    const markdownText = generateCampaignMarkdown(splits);

    try {
      await navigator.clipboard.writeText(markdownText);
      const originalText = markdownBtn.textContent;
      markdownBtn.textContent = 'Copied!';
      setTimeout(() => { markdownBtn.textContent = originalText; }, 2000);
    } catch (err) {
      alert("Failed to copy to clipboard automatically.");
    }
  });
}

// CSV Export Handler
if (csvBtn) {
  csvBtn.addEventListener('click', () => {
    if (viewMode && viewMode.value === 'campaign') {
      exportCampaignCSV();
    } else {
      exportStandardCSV();
    }
  });
}

function exportStandardCSV() {
  const runIdx = runSelect ? runSelect.value : "0";
  const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
  if (!run || !run.length) return;

  const zoneEntries = run.filter(e => e.type === 'zone');
  const thresholdMs = parseInt(thresholdInput ? thresholdInput.value : 6, 10) * 60 * 1000;
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

  downloadBlob(csv, `poe_session_${dateSelect ? dateSelect.value : 'export'}.csv`);
}

function exportCampaignCSV() {
  const runIdx = runSelect ? runSelect.value : "0";
  const run = runIdx === 'all' ? currentRuns.flat() : currentRuns[parseInt(runIdx, 10)];
  if (!run || !run.length) return;

  const splits = calculateCampaignSplits(run);
  if (!splits.length) return;

  let csv = "act,level,split_seconds,split_formatted,total_seconds,total_formatted,timestamp\n";
  splits.forEach(s => {
    csv += `"${s.act}",${s.level},${s.splitSec},"${formatDelta(s.splitSec)}",${s.totalSec},"${formatDelta(s.totalSec)}","${s.dateStr} ${s.timeStr}"\n`;
  });

  downloadBlob(csv, `poe_campaign_splits_${dateSelect ? dateSelect.value : 'export'}.csv`);
}

// --- Theme Management (Dark Mode Default) ---
const themeToggleBtn = document.getElementById('themeToggleBtn');

function initTheme() {
  const savedTheme = localStorage.getItem('poe_theme') || 'dark';
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    if (themeToggleBtn) themeToggleBtn.textContent = 'Dark Mode';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (themeToggleBtn) themeToggleBtn.textContent = 'Light Mode';
  }
}

initTheme();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme === 'light') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('poe_theme', 'dark');
      themeToggleBtn.textContent = 'Light Mode';
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('poe_theme', 'light');
      themeToggleBtn.textContent = 'Dark Mode';
    }
  });
}