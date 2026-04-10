/**
 * Format tasks as a simple text table.
 * @param {Array} tasks
 * @returns {string}
 */
function formatTable(tasks) {
  if (!tasks.length) return "  (no tasks)";

  const lines = tasks.map((t) => {
    const check = t.done ? "✅" : "⬜";
    const cat = `[${t.category}]`.padEnd(10);
    return `  ${check} #${String(t.id).padStart(2)} ${cat} ${t.title}`;
  });

  return lines.join("\n");
}

/**
 * Format stats as a progress bar.
 * @param {{ done: number, total: number }} stats
 * @returns {string}
 */
function progressBar(stats, width = 20) {
  const filled = Math.round((stats.done / stats.total) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = Math.round((stats.done / stats.total) * 100);
  return `[${bar}] ${pct}%`;
}

module.exports = { formatTable, progressBar };
