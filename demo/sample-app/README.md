# Task Tracker

A tiny CLI task tracker used as a demo project for [DemoGod](https://github.com/suuus/demogod).

## Run

```bash
npm start        # shows the task board
npm test         # runs the test suite
```

## Structure

```
src/
  index.js    — entry point, seeds demo data
  store.js    — TaskStore class (in-memory CRUD)
  format.js   — table & progress-bar formatters
tests/
  run.js      — simple assertion-based tests
```
