import { formatDelta } from './utils.js';
import { deriveZoneContext } from './tracker.js';

// Loaded lazily (only once the user opens the panel) so the app makes zero
// external requests until this feature is actually used.
const CDN_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js'
];

// Categorical hues (dataviz skill palette, slots 1-3 — the only three that
// validate all-pairs CVD separation, which a scatter plot needs since every
// pair of series can appear beside each other on screen at once).
const CATEGORY_COLORS = {
  map: { light: '#2a78d6', dark: '#3987e5', label: 'Map' },
  hideout: { light: '#eb6834', dark: '#d95926', label: 'Hideout' },
  town: { light: '#1baf7a', dark: '#199e70', label: 'Town' }
};
const CATEGORY_ORDER = ['map', 'hideout', 'town'];

// Status red (dataviz skill status palette) — reserved for the outlier
// threshold line, never reused as a category color.
const CRITICAL_COLOR = '#d03b3b';

let scriptsLoadingPromise = null;
let scriptsLoaded = false;

let dom = null;
let chartInstance = null;
let panelOpen = false;

let latestRun = [];
let latestPoints = [];
let selectedZone = null;
let percentileConfig = 90;

// User preferences that should survive a data refresh (excluding a row, switching
// gap/threshold) within the same panel session, not just reset back to "all visible"
// every time the chart redraws. Tracked independently of Chart.js's own internal
// per-dataset visibility state, which doesn't survive a destroy+recreate.
let deselectedActKeys = new Set();
let hiddenCategories = new Set();

function actKeyOf(act) {
  return act === null ? 'null' : String(act);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureChartLibrary() {
  if (scriptsLoaded) return true;
  if (!scriptsLoadingPromise) {
    scriptsLoadingPromise = (async () => {
      for (const src of CDN_SCRIPTS) {
        await loadScript(src);
      }
      scriptsLoaded = true;
    })();
  }
  try {
    await scriptsLoadingPromise;
    return true;
  } catch (err) {
    scriptsLoadingPromise = null;
    return false;
  }
}

function isLightTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light';
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function categoryColor(category) {
  const entry = CATEGORY_COLORS[category];
  if (!entry) return isLightTheme() ? '#898781' : '#898781';
  return isLightTheme() ? entry.light : entry.dark;
}

function withAlpha(hex, alpha) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function actLabel(act) {
  if (act === null || act === undefined) return 'No Act Data';
  if (act === 'Maps') return 'Endgame Maps';
  return `Act ${act}`;
}

/**
 * Called whenever the Standard Session view recomputes its processed entries
 * (new run selected, gap/threshold changed, an entry excluded/re-included).
 * Cheap by design — only builds the point list; the expensive Chart.js render
 * only happens if the panel is actually open.
 */
export function updateTimingChart(run, processed) {
  latestRun = run || [];
  const context = deriveZoneContext(latestRun);

  const points = [];
  let seq = 0;
  (processed || []).forEach(entry => {
    if (entry.isExcluded) return;
    if (entry.deltaMs === null || entry.deltaMs === undefined) return;

    const durationSec = Math.floor(entry.deltaMs / 1000);
    const ctx = context.get(entry.entryKey) || {};

    points.push({
      seq: seq++,
      durationSec,
      yPlot: Math.max(durationSec, 1),
      zone: entry.zone,
      dateStr: entry.dateStr,
      timeStr: entry.timeStr,
      level: ctx.level != null ? ctx.level : null,
      act: ctx.act != null ? ctx.act : null,
      category: entry.category,
      entryKey: entry.entryKey
    });
  });

  latestPoints = points;
  selectedZone = null;

  const availableActs = [...new Set(points.map(p => p.act))];
  if (dom) renderActFilterChips(availableActs);

  if (panelOpen && scriptsLoaded) {
    renderChart();
  } else if (panelOpen) {
    showEmptyState('Not enough timed zone entries to chart.');
  }
}

export function clearTimingChart() {
  latestRun = [];
  latestPoints = [];
  selectedZone = null;
  if (dom) renderActFilterChips([]);
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  showEmptyState('No run selected.');
  renderOutlierTable([], null);
}

export function refreshTimingChartTheme() {
  if (panelOpen && chartInstance) {
    renderChart();
  }
}

function showEmptyState(message) {
  if (!dom) return;
  dom.emptyMsg.textContent = message;
  dom.emptyMsg.style.display = 'block';
  dom.canvasWrap.style.display = 'none';
}

function hideEmptyState() {
  if (!dom) return;
  dom.emptyMsg.style.display = 'none';
  dom.canvasWrap.style.display = 'block';
}

function renderActFilterChips(availableActs) {
  const sorted = [...availableActs].sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (a === 'Maps') return 1;
    if (b === 'Maps') return -1;
    return a - b;
  });

  if (!sorted.length) {
    dom.actFilterGroup.innerHTML = '';
    return;
  }

  dom.actFilterGroup.innerHTML = sorted.map(act => {
    const key = actKeyOf(act);
    const isActive = !deselectedActKeys.has(key);
    return `<button type="button" class="act-chip${isActive ? ' active' : ''}" data-act="${key}">${actLabel(act)}</button>`;
  }).join('');
}

function getVisiblePoints() {
  return latestPoints.filter(p => !deselectedActKeys.has(actKeyOf(p.act)));
}

// Points in scope for stats/outliers: act-filtered AND category-legend-visible.
// Datasets themselves (buildDatasets) only need the act filter — Chart.js handles
// hiding a whole category dataset on its own once marked `hidden`.
function getActiveScopePoints() {
  const visibleCats = visibleCategorySet();
  return getVisiblePoints().filter(p => visibleCats.has(p.category));
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * frac;
}

function computeStats(points) {
  if (!points.length) return null;
  const sorted = points.map(p => p.durationSec).sort((a, b) => a - b);
  return {
    median: percentile(sorted, 50),
    p25: percentile(sorted, 25),
    p75: percentile(sorted, 75),
    pThresh: percentile(sorted, percentileConfig)
  };
}

function visibleCategorySet() {
  return new Set(CATEGORY_ORDER.filter(c => !hiddenCategories.has(c)));
}

function buildAnnotations(stats) {
  if (!stats) return {};
  const mutedInk = cssVar('--text-muted') || '#898781';
  const cardBg = cssVar('--card-bg') || (isLightTheme() ? '#ffffff' : '#181a20');

  return {
    iqrBand: {
      type: 'box',
      yMin: stats.p25,
      yMax: stats.p75,
      backgroundColor: withAlpha(mutedInk, 0.14),
      borderWidth: 0
    },
    medianLine: {
      type: 'line',
      yMin: stats.median,
      yMax: stats.median,
      borderColor: mutedInk,
      borderWidth: 2,
      borderDash: [4, 4],
      label: {
        display: true,
        content: `Median: ${formatDelta(Math.round(stats.median))}`,
        position: 'end',
        backgroundColor: cardBg,
        color: mutedInk,
        font: { size: 10 }
      }
    },
    thresholdLine: {
      type: 'line',
      yMin: stats.pThresh,
      yMax: stats.pThresh,
      borderColor: CRITICAL_COLOR,
      borderWidth: 2,
      borderDash: [2, 3],
      label: {
        display: true,
        content: `P${percentileConfig} outlier threshold: ${formatDelta(Math.round(stats.pThresh))}`,
        position: 'start',
        backgroundColor: cardBg,
        color: CRITICAL_COLOR,
        font: { size: 10, weight: 'bold' }
      }
    }
  };
}

function pointStyleFns(categoryKey) {
  return {
    pointBackgroundColor: (ctx) => {
      const raw = ctx.raw;
      const base = categoryColor(categoryKey);
      if (!raw) return base;
      if (selectedZone && raw.zone !== selectedZone) return withAlpha(base, 0.15);
      return base;
    },
    pointRadius: (ctx) => {
      const raw = ctx.raw;
      if (!raw) return 5;
      if (selectedZone) return raw.zone === selectedZone ? 6 : 3;
      return 5;
    },
    pointHoverRadius: 8,
    pointHitRadius: 12,
    pointBorderWidth: 2,
    pointBorderColor: cssVar('--card-bg') || (isLightTheme() ? '#ffffff' : '#181a20')
  };
}

function buildDatasets() {
  const filtered = getVisiblePoints();
  return CATEGORY_ORDER.map(category => {
    const data = filtered.filter(p => p.category === category);
    return {
      label: CATEGORY_COLORS[category].label,
      categoryKey: category,
      data,
      hidden: hiddenCategories.has(category),
      parsing: { xAxisKey: 'seq', yAxisKey: 'yPlot' },
      ...pointStyleFns(category)
    };
  });
}

function recomputeAndRedraw() {
  if (!chartInstance) return;
  const activePoints = getActiveScopePoints();
  const stats = computeStats(activePoints);

  chartInstance.options.plugins.annotation.annotations = buildAnnotations(stats);
  chartInstance.update('none');

  renderOutlierTable(activePoints, stats);
}

function legendClickHandler(e, legendItem, legend) {
  const index = legendItem.datasetIndex;
  const ci = legend.chart;
  const categoryKey = ci.data.datasets[index].categoryKey;

  if (ci.isDatasetVisible(index)) {
    ci.hide(index);
    legendItem.hidden = true;
    hiddenCategories.add(categoryKey);
  } else {
    ci.show(index);
    legendItem.hidden = false;
    hiddenCategories.delete(categoryKey);
  }
  recomputeAndRedraw();
}

function handleChartClick(evt) {
  if (!chartInstance) return;
  const points = chartInstance.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);

  if (!points.length) {
    if (selectedZone !== null) {
      selectedZone = null;
      chartInstance.update();
    }
    return;
  }

  const { datasetIndex, index } = points[0];
  const raw = chartInstance.data.datasets[datasetIndex].data[index];
  selectedZone = selectedZone === raw.zone ? null : raw.zone;
  chartInstance.update();
}

function tooltipLabel(item) {
  const p = item.raw;
  if (!p) return '';
  const lines = [`Time Spent: ${formatDelta(p.durationSec)}`, `When: ${p.dateStr} ${p.timeStr}`];
  if (p.level != null) lines.push(`Level: ${p.level}`);
  lines.push(`Act: ${actLabel(p.act)}`);
  return lines;
}

function renderChart() {
  if (!dom || !window.Chart) return;

  const visiblePointsExist = latestPoints.length > 0;
  if (!visiblePointsExist) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    showEmptyState('Not enough timed zone entries to chart.');
    renderOutlierTable([], null);
    return;
  }

  hideEmptyState();

  const datasets = buildDatasets();
  const stats = computeStats(getActiveScopePoints());
  const mutedInk = cssVar('--text-muted') || '#898781';
  const gridColor = cssVar('--border') || '#2a2e39';

  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  chartInstance = new window.Chart(dom.canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Sequence', color: mutedInk },
          ticks: { color: mutedInk, precision: 0 },
          grid: { color: gridColor }
        },
        y: {
          type: 'logarithmic',
          title: { display: true, text: 'Time Spent (seconds, log scale)', color: mutedInk },
          ticks: { color: mutedInk },
          grid: { color: gridColor }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: mutedInk, usePointStyle: true, pointStyle: 'circle' },
          onClick: legendClickHandler
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.raw?.zone || '',
            label: tooltipLabel
          }
        },
        annotation: {
          annotations: buildAnnotations(stats)
        },
        zoom: {
          pan: { enabled: false },
          zoom: {
            drag: { enabled: true, backgroundColor: withAlpha(mutedInk, 0.15) },
            mode: 'x'
          }
        }
      },
      onClick: handleChartClick
    }
  });

  renderOutlierTable(getActiveScopePoints(), stats);
}

function renderOutlierTable(points, stats) {
  if (!dom) return;

  if (!stats || !points.length) {
    dom.outlierBody.innerHTML = '';
    dom.outlierCount.textContent = '0';
    return;
  }

  const outliers = points
    .filter(p => p.durationSec >= stats.pThresh)
    .sort((a, b) => b.durationSec - a.durationSec);

  dom.outlierCount.textContent = String(outliers.length);

  dom.outlierBody.innerHTML = outliers.map(p => `
    <tr data-entry-key="${p.entryKey}">
      <td>${p.zone}</td>
      <td>${p.dateStr} ${p.timeStr}</td>
      <td>${formatDelta(p.durationSec)}</td>
      <td>${CATEGORY_COLORS[p.category] ? CATEGORY_COLORS[p.category].label : p.category}</td>
    </tr>
  `).join('');
}

function handleOutlierRowClick(e) {
  const row = e.target.closest('tr[data-entry-key]');
  if (!row || !chartInstance) return;

  const point = latestPoints.find(p => p.entryKey === row.dataset.entryKey);
  if (!point) return;

  selectedZone = selectedZone === point.zone ? null : point.zone;
  chartInstance.update();
  dom.canvasWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleActChipClick(e) {
  const chip = e.target.closest('.act-chip');
  if (!chip) return;

  const key = chip.dataset.act;
  if (deselectedActKeys.has(key)) {
    deselectedActKeys.delete(key);
    chip.classList.add('active');
  } else {
    deselectedActKeys.add(key);
    chip.classList.remove('active');
  }

  if (panelOpen && scriptsLoaded) renderChart();
}

/**
 * Wires up the panel toggle, controls, and lazy CDN loading. Call once at startup
 * with references to the DOM elements declared in index.html.
 */
export function initTimingChart(refs) {
  dom = refs;

  dom.toggleBtn.addEventListener('click', async () => {
    panelOpen = !panelOpen;
    dom.toggleBtn.textContent = panelOpen ? 'Hide Timing Chart' : 'Show Timing Chart';
    dom.toggleBtn.setAttribute('aria-expanded', String(panelOpen));
    dom.panel.style.display = panelOpen ? 'block' : 'none';

    if (!panelOpen) return;

    if (!latestPoints.length) {
      showEmptyState('Not enough timed zone entries to chart.');
      return;
    }

    if (!scriptsLoaded) {
      dom.loading.style.display = 'block';
      dom.canvasWrap.style.display = 'none';
      dom.emptyMsg.style.display = 'none';
      const ok = await ensureChartLibrary();
      dom.loading.style.display = 'none';
      if (!ok) {
        showEmptyState('Could not load the charting library — check your internet connection and try again.');
        return;
      }
    }

    renderChart();
  });

  dom.resetZoomBtn.addEventListener('click', () => {
    if (chartInstance && chartInstance.resetZoom) chartInstance.resetZoom();
  });

  dom.percentileSelect.addEventListener('change', () => {
    percentileConfig = parseInt(dom.percentileSelect.value, 10);
    recomputeAndRedraw();
  });

  dom.actFilterGroup.addEventListener('click', handleActChipClick);
  dom.outlierBody.addEventListener('click', handleOutlierRowClick);

  showEmptyState('No run selected.');
}
