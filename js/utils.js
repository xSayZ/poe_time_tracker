/**
 * Formats seconds into HH:MM:SS or MM:SS
 */
export function formatDelta(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Copies path string to user clipboard with visual feedback
 */
export function copyPath(element, pathText) {
  navigator.clipboard.writeText(pathText).then(() => {
    const label = element.querySelector('.copy-btn-text');
    if (!label) return;
    const originalText = label.textContent;
    label.textContent = 'Copied!';
    label.style.color = 'var(--success)';
    setTimeout(() => {
      label.textContent = originalText;
      label.style.color = 'var(--accent)';
    }, 1800);
  }).catch(err => {
    console.error('Copy failed:', err);
  });
}

/**
 * Triggers browser download for dynamic text content
 */
export function downloadBlob(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}