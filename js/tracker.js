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
 * Builds a stable identifier for a parsed entry, used to remember excluded rows
 * across re-sorts, re-filters, and run/date regrouping.
 */
export function entryKey(entry) {
  return `${entry.timestamp.getTime()}|${entry.zone}`;
}

/**
 * Processes zone entries to calculate deltas, long stops, and category totals.
 * levelEntries (optional) are matched to whichever zone the player was in when they leveled up.
 *
 * Each entry's delta is the time spent IN that zone — i.e. the gap until the NEXT entry, not
 * since the previous one — so the duration is shown/attributed on the row for the zone that
 * actually consumed that time (the last entry in a run has no known delta, since there's no
 * next entry to measure against).
 *
 * excludedKeys (optional Set of entryKey values) marks entries whose own delta should never
 * count as tracked time (e.g. an AFK/logout gap the client log still reports against that
 * zone). Each row's delta is computed independently of its neighbors' excluded state, so
 * excluding one entry never affects any other entry's delta.
 */
export function processRunData(zoneEntries, thresholdMinutes, levelEntries = [], excludedKeys = null) {
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const isExcluded = (entry) => excludedKeys ? excludedKeys.has(entryKey(entry)) : false;

  const zoneTotals = {};
  const categoryTotals = { hideout: 0, map: 0, town: 0 };
  let totalTrackedSeconds = 0;

  const processed = zoneEntries.map((entry, i) => {
    const hasNext = i < zoneEntries.length - 1;
    const deltaMs = hasNext ? (zoneEntries[i + 1].timestamp - entry.timestamp) : null;
    const excluded = isExcluded(entry);
    const isLong = !excluded && Boolean(deltaMs) && deltaMs > thresholdMs;

    if (hasNext && !excluded) {
      const durationSec = Math.floor(deltaMs / 1000);

      zoneTotals[entry.zone] = (zoneTotals[entry.zone] || 0) + durationSec;
      const cat = categorizeZone(entry.zone);
      categoryTotals[cat] += durationSec;
      totalTrackedSeconds += durationSec;
    }

    const windowEnd = hasNext ? zoneEntries[i + 1].timestamp : Infinity;
    const levelUpsInZone = levelEntries.filter(l => l.timestamp >= entry.timestamp && l.timestamp < windowEnd);
    const leveledUpTo = levelUpsInZone.length ? levelUpsInZone[levelUpsInZone.length - 1].level : null;

    return {
      ...entry,
      originalIndex: i,
      deltaMs,
      isLong,
      category: categorizeZone(entry.zone),
      leveledUpTo,
      isExcluded: excluded,
      entryKey: entryKey(entry)
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