const { TaskStore } = require("../src/store");
const { formatTable, progressBar } = require("../src/format");

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

console.log("\n🧪 TaskStore tests\n");

// Test add
const store = new TaskStore();
const t1 = store.add("Test task", "dev");
assert("add() returns task with id", t1.id === 1);
assert("add() sets category", t1.category === "dev");
assert("add() defaults done=false", t1.done === false);
assert("add() defaults priority=2", t1.priority === 2);

// Test priority
const tp = store.add("Priority task", "dev", 1);
assert("add() accepts custom priority", tp.priority === 1);
let threwPriority = false;
try { store.add("Bad priority", "dev", 5); } catch { threwPriority = true; }
assert("add() throws on invalid priority", threwPriority);
store.remove(tp.id);

// Test complete
store.complete(1);
assert("complete() marks task done", store.list()[0].done === true);

// Test list filter
store.add("Another task", "ops");
assert("list() returns all tasks", store.list().length === 2);
assert("list({category}) filters", store.list({ category: "ops" }).length === 1);
assert("list({done}) filters", store.list({ done: true }).length === 1);

// Test stats
const s = store.stats();
assert("stats().total is correct", s.total === 2);
assert("stats().done is correct", s.done === 1);
assert("stats().pending is correct", s.pending === 1);

// Test remove
store.remove(1);
assert("remove() reduces count", store.list().length === 1);

// Test error on bad id
let threw = false;
try { store.complete(999); } catch { threw = true; }
assert("complete(bad id) throws", threw);

// Test format
const output = formatTable(store.list());
assert("formatTable() contains task title", output.includes("Another task"));

const bar = progressBar({ done: 3, total: 10 });
assert("progressBar() contains percentage", bar.includes("30%"));

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
