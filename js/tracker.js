export const TOWN_KEYWORDS = [
  'encampment', 'watch', 'highgate', 'shores', 'bridge', 
  'kingsmarch', 'rogue harbour', 'aspirants\' plaza', 'town'
];

export const ACT_TRIGGERS = [
  { act: 1,  zone: "Lioneye's Watch" },
  { act: 2,  zone: "The Forest Encampment" },
  { act: 3,  zone: "The Sarn Encampment" },
  { act: 4,  zone: "Highgate" },
  { act: 5,  zone: "Overseer's Tower" },
  { act: 6,  zone: "Lioneye's Watch" },
  { act: 7,  zone: "The Bridge Encampment" },
  { act: 8,  zone: "The Sarn Encampment" },
  { act: 9,  zone: "Highgate" },
  { act: 10, zone: "Oriath Docks" },
  { act: "Maps", zone: "Karui Shores" }
];

/**
 * Classifies a zone as hideout, town, or map
 */
export function categorizeZone(zoneName) {
  const lower = zoneName.toLowerCase();
  if (lower.includes('hideout')) return 'hideout';
  if (TOWN_KEYWORDS.some(kw => lower.includes(kw))) return 'town';
  return 'map';
}

/**
 * Groups raw entries into session runs based on gap minutes
 */
export function groupEntriesIntoRuns(entries, gapMinutes) {
  const gapMs = gapMinutes * 60 * 1000;
  const runs = [];

  if (entries.length) {
    let currentRun = [entries[0]];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].timestamp - entries[i - 1].timestamp > gapMs) {
        runs.push(currentRun);
        currentRun = [];
      }
      currentRun.push(entries[i]);
    }
    if (currentRun.length) runs.push(currentRun);
  }

  return runs;
}

/**
 * Processes zone entries to calculate deltas, long stops, and category totals
 */
export function processRunData(zoneEntries, thresholdMinutes) {
  const thresholdMs = thresholdMinutes * 60 * 1000;
  let prevTime = null;

  const zoneTotals = {};
  const categoryTotals = { hideout: 0, map: 0, town: 0 };
  let totalTrackedSeconds = 0;

  const processed = zoneEntries.map((entry, i) => {
    const deltaMs = prevTime ? (entry.timestamp - prevTime) : null;
    const isLong = deltaMs && deltaMs > thresholdMs;

    if (prevTime && i > 0) {
      const prevEntry = zoneEntries[i - 1];
      const durationSec = Math.floor(deltaMs / 1000);
      
      zoneTotals[prevEntry.zone] = (zoneTotals[prevEntry.zone] || 0) + durationSec;
      const cat = categorizeZone(prevEntry.zone);
      categoryTotals[cat] += durationSec;
      totalTrackedSeconds += durationSec;
    }

    prevTime = entry.timestamp;

    return {
      ...entry,
      originalIndex: i,
      deltaMs: deltaMs,
      isLong: isLong,
      category: categorizeZone(entry.zone)
    };
  });

  return { processed, categoryTotals, zoneTotals, totalTrackedSeconds };
}

/**
 * Evaluates campaign Act splits for a given run
 */
export function calculateCampaignSplits(runEntries) {
  let currentActIdx = 0;
  let currentLevel = 1;
  const splits = [];
  let campaignStart = null;

  for (const entry of runEntries) {
    if (entry.type === 'level') {
      currentLevel = entry.level;
      continue;
    }

    if (entry.type === 'zone' && currentActIdx < ACT_TRIGGERS.length) {
      const target = ACT_TRIGGERS[currentActIdx];

      if (entry.zone.toLowerCase().includes(target.zone.toLowerCase())) {
        if (!campaignStart) campaignStart = entry.timestamp;

        const prevSplit = splits[splits.length - 1];
        const splitSec = prevSplit 
          ? Math.floor((entry.timestamp - prevSplit.timestamp) / 1000)
          : 0;
        const totalSec = Math.floor((entry.timestamp - campaignStart) / 1000);

        splits.push({
          act: target.act,
          zone: entry.zone,
          timestamp: entry.timestamp,
          dateStr: entry.dateStr,
          timeStr: entry.timeStr,
          level: currentLevel,
          splitSec: splitSec,
          totalSec: totalSec
        });

        currentActIdx++;
      }
    }
  }

  return splits;
}