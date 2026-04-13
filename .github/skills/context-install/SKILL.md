---
name: context-install
description: Write MCP server configurations to .mcp.json
user-invocable: true
---

Install the approved MCP servers by writing their configuration to `.mcp.json`.

## Process

1. Read the existing `.mcp.json` if it exists (preserve existing entries)
2. For each approved MCP server from the review phase:
   - Add the entry to the `mcpServers` object
   - Use the standard format:
     ```json
     {
       "mcpServers": {
         "server-name": {
           "command": "npx",
           "args": ["@vendor/mcp-server"],
           "type": "local",
           "tools": ["*"]
         }
       }
     }
     ```
   - Report: ✅ Added {server-name} or ❌ Failed: {reason}
3. Write the updated `.mcp.json` using the edit or create tool
4. Do NOT run npm install — just write the config. The MCP server will be fetched on first use by npx.

## Important
- Preserve any existing MCP server entries
- Respect the org blocked list — do not add blocked servers
- Use the install command discovered in Phase 2

Then output: `<!--phase:5:complete-->`
