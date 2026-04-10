const { TaskStore } = require("./store");
const { formatTable } = require("./format");

const store = new TaskStore();

// Seed some demo tasks
store.add("Set up CI pipeline", "ops");
store.add("Write unit tests for auth", "dev");
store.add("Design landing page", "design");
store.add("Fix memory leak in worker", "dev");
store.add("Update README", "docs");

// Mark a couple done
store.complete(1);
store.complete(5);

// Display
console.log("\n📋 Task Tracker\n");
console.log(formatTable(store.list()));
console.log(`\n${store.stats().done}/${store.stats().total} tasks completed`);

// TODO: add CLI argument parsing
// TODO: persist tasks to disk
// FIXME: stats() recalculates every call — should cache
