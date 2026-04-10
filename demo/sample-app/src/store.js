class TaskStore {
  constructor() {
    this._tasks = [];
    this._nextId = 1;
  }

  add(title, category = "general", priority = 2) {
    if (priority < 1 || priority > 3) throw new Error("Priority must be 1-3");
    const task = {
      id: this._nextId++,
      title,
      category,
      priority,
      done: false,
      createdAt: new Date(),
    };
    this._tasks.push(task);
    return task;
  }

  complete(id) {
    const task = this._tasks.find((t) => t.id === id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.done = true;
    task.completedAt = new Date();
    return task;
  }

  list(filter = {}) {
    let result = [...this._tasks];
    if (filter.category) result = result.filter((t) => t.category === filter.category);
    if (filter.done !== undefined) result = result.filter((t) => t.done === filter.done);
    return result;
  }

  stats() {
    // FIXME: this is O(n) every call — fine for small lists
    const total = this._tasks.length;
    const done = this._tasks.filter((t) => t.done).length;
    return { total, done, pending: total - done };
  }

  remove(id) {
    const idx = this._tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task ${id} not found`);
    return this._tasks.splice(idx, 1)[0];
  }
}

module.exports = { TaskStore };
