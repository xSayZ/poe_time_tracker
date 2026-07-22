const ZONE_REGEX = /^(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+.*?: You have entered (.+?)\.?$/i;
const LEVEL_REGEX = /^(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2})\s+.*?: (.+?)(?:\s*\((.+?)\))?\s+is now level\s+(\d+)$/i;

/**
 * Streams and parses Client.txt to extract zone and level events.
 * Executes onProgress callback with integer percentage (0 to 100).
 */
export async function parseClientLogFile(file, onProgress) {
  const parsedEntries = [];
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let bytesRead = 0;
  const totalBytes = file.size;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytesRead += value.byteLength;
    if (onProgress) {
      onProgress(Math.round((bytesRead / totalBytes) * 100));
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      
      const zoneMatch = trimmed.match(ZONE_REGEX);
      if (zoneMatch) {
        const dateStr = zoneMatch[1].replace(/\//g, '-');
        const timeStr = zoneMatch[2];
        const timestamp = new Date(`${dateStr}T${timeStr}`);
        parsedEntries.push({ type: 'zone', dateStr, timeStr, timestamp, zone: zoneMatch[3] });
        continue;
      }

      const levelMatch = trimmed.match(LEVEL_REGEX);
      if (levelMatch) {
        const dateStr = levelMatch[1].replace(/\//g, '-');
        const timeStr = levelMatch[2];
        const timestamp = new Date(`${dateStr}T${timeStr}`);
        parsedEntries.push({ 
          type: 'level', 
          dateStr, 
          timeStr, 
          timestamp, 
          charName: levelMatch[3], 
          level: parseInt(levelMatch[5], 10) 
        });
      }
    }
  }

  return parsedEntries;
}