import { APP_VERSION, APP_NAME } from './version.js';
import { formatDelta, copyPath, downloadBlob } from './utils.js';
import { parseClientLogFile } from './parser.js';
import {
  categorizeZone,
  groupEntriesIntoRuns,
  processRunData,
  calculateCampaignSplits,
  entryKey
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
let excludedKeys = new Set();

let visibleCount = 50;
const BATCH_SIZE = 50;
let observer = null;
let compareMode = false;

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
const compareToggle = document.getElementById('compareToggle');
const compareDateContainer = document.getElementById('compareDateContainer');
const dateSelectB = document.getElementById('dateSelectB');
const runSelectBContainer = document.getElementById('runSelectBContainer');
const runSelectB = document.getElementById('runSelectB');
const compareView = document.getElementById('compareView');
const compareContent = document.getElementById('compareContent');
const exportBtnGroup = document.getElementById('exportBtnGroup');

let currentRunsB = [];

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
  viewMode.addEventListener('change', () => refreshDisplay());
}

// Compare mode toggle
if (compareToggle) {
  compareToggle.addEventListener('change', () => {
    compareMode = compareToggle.checked;
    if (compareDateContainer) compareDateContainer.style.display = compareMode ? 'flex' : 'none';
    if (runSelectBContainer) runSelectBContainer.style.display = compareMode ? 'flex' : 'none';
    if (compareMode) populateRunSelectB();
    refreshDisplay();
  });
}

if (dateSelectB) {
  dateSelectB.addEventListener('change', () => {
    populateRunSelectB();
    refreshDisplay();
  });
}

if (runSelectB) {
  runSelectB.addEventListener('change', () => refreshDisplay());
}

// Renders whichever view (standard, campaign, or comparison) is currently active
function refreshDisplay() {
  if (compareMode) {
    if (standardView) standardView.style.display = 'none';
    if (campaignView) campaignView.style.display = 'none';
    if (compareView) compareView.style.display = 'block';
    if (exportBtnGroup) exportBtnGroup.style.display = 'none';
    renderComparison();
    return;
  }

  if (compareView) compareView.style.display = 'none';
  if (exportBtnGroup) exportBtnGroup.style.display = 'flex';

  if (viewMode && viewMode.value === 'campaign') {
    if (standardView) standardView.style.display = 'none';
    if (campaignView) campaignView.style.display = 'block';
    displayCampaignSplits();
  } else {
    if (standardView) standardView.style.display = 'block';
    if (campaignView) campaignView.style.display = 'none';
    displayRun();
  }
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

// Right-click a row to exclude/re-include it from Standard Session calculations
if (resultsBody) {
  resultsBody.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('tr[data-entry-key]');
    if (!row) return;
    e.preventDefault();

    const key = row.dataset.entryKey;
    if (excludedKeys.has(key)) {
      excludedKeys.delete(key);
    } else {
      excludedKeys.add(key);
    }
    displayRun(false);
  });
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

  excludedKeys = new Set();
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
  const dateOptionsHtml = dates.map(d => `<option value="${d}">${d}</option>`).join('') + '<option value="all">All Dates</option>';

  if (dateSelect) {
    dateSelect.innerHTML = dateOptionsHtml;
    dateSelect.value = dates[dates.length - 1];
  }
  if (dateSelectB) {
    dateSelectB.innerHTML = dateOptionsHtml;
    dateSelectB.value = dates[dates.length - 1];
  }
  recalculate();
}

if (dateSelect) dateSelect.addEventListener('change', recalculate);
if (runSelect) {
  runSelect.addEventListener('change', () => {
    syncRunSelectBAvailability();
    refreshDisplay();
  });
}

// Groups entries for an arbitrary date (or 'all') into runs using the current gap setting
function getRunsForDate(dateStr) {
  const filtered = dateStr === 'all'
    ? parsedEntries
    : parsedEntries.filter(e => e.dateStr === dateStr);

  const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);
  const gapMinutes = parseInt(gapInput ? gapInput.value : 30, 10);
  return groupEntriesIntoRuns(sorted, gapMinutes);
}

function buildRunOptionsHtml(runs) {
  return runs.map((r, i) => {
    const start = r[0].timeStr;
    const end = r[r.length - 1].timeStr;
    const zoneCount = r.filter(e => e.type === 'zone').length;
    return `<option value="${i}">Run ${i + 1} — ${r[0].dateStr} (${start} - ${end}) [${zoneCount} zones]</option>`;
  }).join('') + '<option value="all">All Runs Combined</option>';
}

// Repopulates the "Compare To" run list for whichever date is selected in dateSelectB
function populateRunSelectB() {
  if (!runSelectB) return;

  const dateVal = dateSelectB ? dateSelectB.value : (dateSelect ? dateSelect.value : 'all');
  currentRunsB = getRunsForDate(dateVal);

  runSelectB.innerHTML = buildRunOptionsHtml(currentRunsB);
  runSelectB.value = currentRunsB.length > 1 ? String(currentRunsB.length - 1) : "0";

  syncRunSelectBAvailability();
}

// Disables the option in runSelectB that would resolve to the exact same run as runSelect (Run A),
// so the same run can't be picked on both sides of a comparison
function syncRunSelectBAvailability() {
  if (!runSelectB) return;

  const dateA = dateSelect ? dateSelect.value : 'all';
  const dateB = dateSelectB ? dateSelectB.value : 'all';
  const idxA = runSelect ? runSelect.value : '0';
  const sameDate = dateA === dateB;

  let needsReselect = false;
  Array.from(runSelectB.options).forEach(opt => {
    const isSameRun = sameDate && opt.value === idxA;
    opt.disabled = isSameRun;
    if (isSameRun && runSelectB.value === opt.value) needsReselect = true;
  });

  if (needsReselect) {
    const firstEnabled = Array.from(runSelectB.options).find(o => !o.disabled);
    if (firstEnabled) runSelectB.value = firstEnabled.value;
  }
}

// Whether there are at least two distinct runs anywhere in the parsed log (needed to enable Compare)
function hasAtLeastTwoRunsOverall() {
  const dates = [...new Set(parsedEntries.map(e => e.dateStr))];
  if (dates.length > 1) return true;
  return currentRuns.length > 1;
}

function recalculate() {
  if (!parsedEntries.length) return;

  const selectedDate = dateSelect ? dateSelect.value : 'all';
  currentRuns = getRunsForDate(selectedDate);

  if (runSelect) {
    runSelect.innerHTML = buildRunOptionsHtml(currentRuns);
    runSelect.value = "0";
  }

  populateRunSelectB();

  if (compareToggle) {
    const enoughRuns = hasAtLeastTwoRunsOverall();
    compareToggle.disabled = !enoughRuns;
    if (!enoughRuns && compareMode) {
      compareMode = false;
      compareToggle.checked = false;
      if (compareDateContainer) compareDateContainer.style.display = 'none';
      if (runSelectBContainer) runSelectBContainer.style.display = 'none';
    }
  }

  refreshDisplay();
}

function displayRun(resetVisible = true) {
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

  const levelEntries = run.filter(e => e.type === 'level');
  const thresholdMinutes = parseInt(thresholdInput ? thresholdInput.value : 6, 10);
  const { processed, categoryTotals, zoneTotals, totalTrackedSeconds } = processRunData(zoneEntries, thresholdMinutes, levelEntries, excludedKeys);
  currentRunProcessed = processed;

  renderAnalytics(categoryTotals, zoneTotals, totalTrackedSeconds, zoneEntries);
  renderStandardTable(resetVisible);
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
    const deltaStr = entry.isExcluded ? '--' : (entry.deltaMs ? formatDelta(Math.floor(entry.deltaMs / 1000)) : '--');
    const isTown = entry.category === 'town';
    const rowClasses = [
      entry.isLong ? 'row-long-stop' : '',
      entry.isExcluded ? 'row-excluded' : ''
    ].filter(Boolean).join(' ');

    html += `
      <tr class="${rowClasses}" data-entry-key="${entry.entryKey}" title="Right-click to ${entry.isExcluded ? 're-include' : 'exclude'} this entry">
        <td>${entry.dateStr} ${entry.timeStr}</td>
        <td>${deltaStr}</td>
        <td>
          ${entry.zone}
          ${isTown ? '<span class="badge badge-town">TOWN</span>' : ''}
          ${entry.isLong ? '<span class="badge badge-danger">LONG STOP</span>' : ''}
          ${entry.leveledUpTo ? `<span class="badge badge-level">LEVEL ${entry.leveledUpTo}</span>` : ''}
          ${entry.isExcluded ? '<span class="badge badge-excluded">EXCLUDED</span>' : ''}
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

  const excludedCount = zoneEntries.filter(e => excludedKeys.has(entryKey(e))).length;

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
          <span>Entries: <strong>${zoneEntries.length}</strong>${excludedCount ? ` <span class="diff-neutral">(${excludedCount} excluded)</span>` : ''}</span>
          <span>Run Duration: <strong>${formatDelta(totalSec)}</strong></span>
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
    <table id="campaignSplitTable" aria-label="Campaign Act Split Breakdown">
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

// --- Run Comparison ---

function formatSignedDelta(sec) {
  const sign = sec > 0 ? '+' : sec < 0 ? '-' : '';
  return `${sign}${formatDelta(Math.abs(sec))}`;
}

function diffClass(sec) {
  if (sec > 0) return 'diff-positive';
  if (sec < 0) return 'diff-negative';
  return 'diff-neutral';
}

function getRunLabel(selectEl) {
  if (!selectEl || !selectEl.options.length) return 'Run';
  const opt = selectEl.options[selectEl.selectedIndex];
  return opt ? opt.text : 'Run';
}

function renderComparison() {
  const dateA = dateSelect ? dateSelect.value : 'all';
  const dateB = dateSelectB ? dateSelectB.value : 'all';
  const idxA = runSelect ? runSelect.value : "0";
  const idxB = runSelectB ? runSelectB.value : "0";

  if (dateA === dateB && idxA === idxB) {
    if (compareContent) compareContent.innerHTML = `<p class="empty-msg">Choose two different runs to compare — pick a different run or a different Compare Date.</p>`;
    return;
  }

  const runA = idxA === 'all' ? currentRuns.flat() : currentRuns[parseInt(idxA, 10)];
  const runB = idxB === 'all' ? currentRunsB.flat() : currentRunsB[parseInt(idxB, 10)];

  if (!runA || !runA.length || !runB || !runB.length) {
    if (compareContent) compareContent.innerHTML = `<p class="empty-msg">Select two valid runs to compare.</p>`;
    return;
  }

  if (viewMode && viewMode.value === 'campaign') {
    renderCampaignComparison(runA, runB);
  } else {
    renderStandardComparison(runA, runB);
  }
}

function renderStandardComparison(runA, runB) {
  const zoneA = runA.filter(e => e.type === 'zone');
  const zoneB = runB.filter(e => e.type === 'zone');

  if (!zoneA.length || !zoneB.length) {
    if (compareContent) compareContent.innerHTML = `<p class="empty-msg">Both selected runs need zone entries to compare.</p>`;
    return;
  }

  const thresholdMinutes = parseInt(thresholdInput ? thresholdInput.value : 6, 10);
  const dataA = processRunData(zoneA, thresholdMinutes, [], excludedKeys);
  const dataB = processRunData(zoneB, thresholdMinutes, [], excludedKeys);

  const rows = [
    { label: 'Total Duration', a: dataA.totalTrackedSeconds, b: dataB.totalTrackedSeconds, isTime: true },
    { label: 'Map/Zone Time', a: dataA.categoryTotals.map, b: dataB.categoryTotals.map, isTime: true },
    { label: 'Hideout Time', a: dataA.categoryTotals.hideout, b: dataB.categoryTotals.hideout, isTime: true },
    { label: 'Town Time', a: dataA.categoryTotals.town, b: dataB.categoryTotals.town, isTime: true },
    { label: 'Zone Entries', a: zoneA.length, b: zoneB.length, isTime: false }
  ];

  let tableRows = '';
  rows.forEach(r => {
    const diff = r.b - r.a;
    const valA = r.isTime ? formatDelta(r.a) : r.a;
    const valB = r.isTime ? formatDelta(r.b) : r.b;
    const diffStr = r.isTime ? formatSignedDelta(diff) : (diff > 0 ? `+${diff}` : String(diff));
    const cls = r.isTime ? diffClass(diff) : 'diff-neutral';

    tableRows += `
      <tr>
        <td>${r.label}</td>
        <td>${valA}</td>
        <td>${valB}</td>
        <td class="diff-cell ${cls}">${diffStr}</td>
      </tr>
    `;
  });

  if (compareContent) {
    compareContent.innerHTML = `
      <div class="campaign-title">Run Comparison</div>
      <div class="campaign-subtitle">${getRunLabel(runSelect)} <strong>vs</strong> ${getRunLabel(runSelectB)}</div>
      <table id="standardCompareTable" aria-label="Standard Run Comparison">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Run A</th>
            <th scope="col">Run B</th>
            <th scope="col">Diff (B - A)</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    `;
  }
}

function renderCampaignComparison(runA, runB) {
  const splitsA = calculateCampaignSplits(runA);
  const splitsB = calculateCampaignSplits(runB);

  if (!splitsA.length || !splitsB.length) {
    if (compareContent) compareContent.innerHTML = `<p class="empty-msg">Both selected runs need sequential campaign Act transitions to compare.</p>`;
    return;
  }

  const maxLen = Math.max(splitsA.length, splitsB.length);
  let rows = '';

  for (let i = 0; i < maxLen; i++) {
    const sA = splitsA[i];
    const sB = splitsB[i];
    const act = sA ? sA.act : sB.act;
    const label = act === 'Maps' ? 'Endgame Maps' : `Act ${act}`;

    const lvlA = sA ? `Lv. ${sA.level}` : '--';
    const lvlB = sB ? `Lv. ${sB.level}` : '--';
    const splitA = sA ? (i === 0 ? '--' : formatDelta(sA.splitSec)) : '--';
    const splitB = sB ? (i === 0 ? '--' : formatDelta(sB.splitSec)) : '--';

    let diffStr = '--';
    let cls = 'diff-neutral';
    if (sA && sB && i > 0) {
      const diff = sB.splitSec - sA.splitSec;
      diffStr = formatSignedDelta(diff);
      cls = diffClass(diff);
    }

    rows += `
      <tr>
        <td><strong>${label}</strong></td>
        <td>${lvlA}</td>
        <td>${splitA}</td>
        <td>${lvlB}</td>
        <td>${splitB}</td>
        <td class="diff-cell ${cls}">${diffStr}</td>
      </tr>
    `;
  }

  const totalA = splitsA.length > 1 ? splitsA[splitsA.length - 1].totalSec : 0;
  const totalB = splitsB.length > 1 ? splitsB[splitsB.length - 1].totalSec : 0;
  const totalDiff = totalB - totalA;

  if (compareContent) {
    compareContent.innerHTML = `
      <div class="campaign-title">Campaign Split Comparison</div>
      <div class="campaign-subtitle">
        ${getRunLabel(runSelect)} (Total: <strong>${formatDelta(totalA)}</strong>)
        <strong>vs</strong>
        ${getRunLabel(runSelectB)} (Total: <strong>${formatDelta(totalB)}</strong>)
        &mdash; Diff: <strong class="${diffClass(totalDiff)}">${formatSignedDelta(totalDiff)}</strong>
      </div>
      <table id="campaignCompareTable" aria-label="Campaign Act Split Comparison">
        <thead>
          <tr>
            <th scope="col">Act / Stage</th>
            <th scope="col">Run A Level</th>
            <th scope="col">Run A Split</th>
            <th scope="col">Run B Level</th>
            <th scope="col">Run B Split</th>
            <th scope="col">Split Diff</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
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
  if (!zoneEntries.length) return;

  const thresholdMinutes = parseInt(thresholdInput ? thresholdInput.value : 6, 10);
  const { processed } = processRunData(zoneEntries, thresholdMinutes, [], excludedKeys);

  let csv = "timestamp,delta_seconds,delta_formatted,long_stop,excluded,zone,category\n";

  processed.forEach(entry => {
    const deltaSec = (!entry.isExcluded && entry.deltaMs) ? Math.floor(entry.deltaMs / 1000) : 0;

    csv += `"${entry.dateStr} ${entry.timeStr}",${deltaSec},"${formatDelta(deltaSec)}","${entry.isLong ? 'YES' : ''}","${entry.isExcluded ? 'YES' : ''}","${entry.zone.replace(/"/g, '""')}","${entry.category}"\n`;
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