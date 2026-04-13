import { describe, it, expect } from "vitest";

/**
 * These are extracted copies of the SQL parsing functions from app.js
 * for unit testing. If the app.js implementations change, update these.
 */

function splitSqlValues(str: string): string[] {
  const vals: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === quoteChar && str[i + 1] === quoteChar) {
        current += ch;
        i++;
      } else if (ch === quoteChar) {
        inQuote = false;
      }
      current += ch;
    } else if (ch === "'" || ch === '"') {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (ch === ",") {
      vals.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  vals.push(current.trim());
  return vals;
}

function unquoteSql(val: string): string {
  if (!val) return "";
  const trimmed = val.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function extractTuples(valuesStr: string): string[] {
  const tuples: string[] = [];
  let depth = 0, start = -1, inQuote = false, qChar = "";
  for (let i = 0; i < valuesStr.length; i++) {
    const ch = valuesStr[i];
    if (inQuote) {
      if (ch === qChar && valuesStr[i + 1] === qChar) { i++; continue; }
      if (ch === qChar) inQuote = false;
    } else if (ch === "'" || ch === '"') {
      inQuote = true; qChar = ch;
    } else if (ch === "(") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesStr.slice(start, i));
        start = -1;
      }
    }
  }
  return tuples;
}

function parseTodoInsert(query: string): Map<string, any> {
  const todos = new Map<string, any>();
  const colMatch = query.match(/INSERT\s+INTO\s+todos\s*\(([^)]+)\)\s*VALUES\s*/i);
  if (!colMatch) return todos;
  const cols = colMatch[1].split(",").map(c => c.trim().toLowerCase());
  const valuesStr = query.slice(colMatch.index! + colMatch[0].length);
  const tuples = extractTuples(valuesStr);
  for (const tuple of tuples) {
    const vals = splitSqlValues(tuple);
    const row: Record<string, string> = {};
    cols.forEach((col, i) => { row[col] = unquoteSql(vals[i] || ""); });
    if (row.id) {
      todos.set(row.id, {
        id: row.id,
        title: row.title || row.id,
        description: row.description || "",
        status: row.status || "pending",
      });
    }
  }
  return todos;
}

describe("SQL parser", () => {
  describe("splitSqlValues", () => {
    it("splits simple values", () => {
      expect(splitSqlValues("'a', 'b', 'c'")).toEqual(["'a'", "'b'", "'c'"]);
    });

    it("handles values with commas inside quotes", () => {
      expect(splitSqlValues("'hello, world', 'foo'")).toEqual(["'hello, world'", "'foo'"]);
    });

    it("handles escaped quotes", () => {
      expect(splitSqlValues("'it''s a test', 'ok'")).toEqual(["'it''s a test'", "'ok'"]);
    });

    it("handles unquoted values", () => {
      expect(splitSqlValues("42, 'text', NULL")).toEqual(["42", "'text'", "NULL"]);
    });
  });

  describe("unquoteSql", () => {
    it("removes single quotes", () => {
      expect(unquoteSql("'hello'")).toBe("hello");
    });

    it("removes double quotes", () => {
      expect(unquoteSql('"hello"')).toBe("hello");
    });

    it("unescapes doubled single quotes", () => {
      expect(unquoteSql("'it''s'")).toBe("it's");
    });

    it("returns unquoted values as-is", () => {
      expect(unquoteSql("42")).toBe("42");
    });

    it("handles empty string", () => {
      expect(unquoteSql("")).toBe("");
    });
  });

  describe("extractTuples", () => {
    it("extracts simple tuples", () => {
      expect(extractTuples("('a', 'b'), ('c', 'd')")).toEqual(["'a', 'b'", "'c', 'd'"]);
    });

    it("handles values containing parentheses inside quotes", () => {
      expect(extractTuples("('foo (bar)', 'baz')")).toEqual(["'foo (bar)', 'baz'"]);
    });

    it("handles escaped quotes inside tuples", () => {
      expect(extractTuples("('it''s', 'ok')")).toEqual(["'it''s', 'ok'"]);
    });

    it("handles multi-line tuples", () => {
      const input = "(\n  'id-1',\n  'title',\n  'desc'\n)";
      const result = extractTuples(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("'id-1'");
      expect(result[0]).toContain("'title'");
      expect(result[0]).toContain("'desc'");
    });
  });

  describe("parseTodoInsert", () => {
    it("parses a simple single-row INSERT", () => {
      const query = "INSERT INTO todos (id, title, status) VALUES ('task-1', 'Do the thing', 'pending')";
      const todos = parseTodoInsert(query);
      expect(todos.size).toBe(1);
      expect(todos.get("task-1")).toEqual({
        id: "task-1",
        title: "Do the thing",
        description: "",
        status: "pending",
      });
    });

    it("parses multi-row INSERT", () => {
      const query = `INSERT INTO todos (id, title, description, status) VALUES
        ('t1', 'First', 'desc 1', 'pending'),
        ('t2', 'Second', 'desc 2', 'in_progress')`;
      const todos = parseTodoInsert(query);
      expect(todos.size).toBe(2);
      expect(todos.get("t1")?.title).toBe("First");
      expect(todos.get("t2")?.status).toBe("in_progress");
    });

    it("handles descriptions with parentheses", () => {
      const query = "INSERT INTO todos (id, title, description) VALUES ('t1', 'Task', 'Fix the bug (critical)')";
      const todos = parseTodoInsert(query);
      expect(todos.get("t1")?.description).toBe("Fix the bug (critical)");
    });

    it("handles descriptions with escaped quotes", () => {
      const query = "INSERT INTO todos (id, title, description) VALUES ('t1', 'Task', 'Don''t break it')";
      const todos = parseTodoInsert(query);
      expect(todos.get("t1")?.description).toBe("Don't break it");
    });

    it("returns empty map for non-todo INSERT", () => {
      const query = "INSERT INTO other_table (id) VALUES ('x')";
      expect(parseTodoInsert(query).size).toBe(0);
    });

    it("handles kebab-case IDs", () => {
      const query = "INSERT INTO todos (id, title) VALUES ('user-auth-flow', 'Implement auth')";
      const todos = parseTodoInsert(query);
      expect(todos.get("user-auth-flow")?.title).toBe("Implement auth");
    });
  });
});
