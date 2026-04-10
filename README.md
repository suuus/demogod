# DemoGod 🎬

<p align="center">
  <img src="docs/logo.svg" alt="DemoGod logo" width="700" />
</p>

> Demo video generator for GitHub Copilot CLI

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v16+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

DemoGod is a web-based tool that creates interactive demo videos for GitHub Copilot CLI. It provides a simulated terminal interface that can execute scripted demos or connect to a real Copilot session for live demonstrations.

**Use Cases:**
- Create polished demo videos for presentations
- Test Copilot interactions in a controlled environment
- Record reproducible demo sequences
- Showcase GitHub Copilot CLI capabilities

## Features

- **Interactive Terminal UI**: Web-based terminal interface for demonstrations
- **Scripted Demos**: Execute pre-recorded demo scripts with realistic typing animations
- **Live Copilot Integration**: Connect to real Copilot CLI sessions via WebSocket bridge
- **Project Browser**: Browse and select working directories for Copilot sessions
- **Real-time Streaming**: See Copilot responses as they are generated
- **Tool Execution Visualization**: Watch tool calls and their results in real-time
- **File Change Tracking**: Monitor file modifications during demo execution

## Architecture

The project is a TypeScript/Node.js application with a zero-dependency vanilla JS frontend.

- **Express Server**: Serves the web UI and handles API requests
- **WebSocket Server**: Real-time bidirectional communication between UI and Copilot
- **Copilot Bridge**: Integration layer wrapping the `@github/copilot-sdk`
- **Demo Engine**: Executes scripted demo sequences with realistic timing
- **Plugin System**: Discovers skills and agents from `~/.copilot/installed-plugins/`

For a deep dive into components, data flows, and extension points, see **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## Getting Started

### Prerequisites

- **Node.js** v16 or higher ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **GitHub Copilot CLI** access (for live sessions)
- Optional: **Python 3.9+** and **Azure Functions Core Tools** (for Azure Function features)

### Installation

```bash
# Clone the repository (if not already cloned)
# git clone <repository-url>
# cd demogod

# Install Node.js dependencies
npm install

# Optional: Install Python dependencies for Azure Functions
pip install -r requirements.txt
```

### Running the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The server will start at `http://localhost:3456` by default. You can customize the port with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Project Structure

```
demogod/
├── src/
│   ├── server.ts           # Express + WS server, REST API, plugin scanners, demo engine
│   ├── copilot-bridge.ts   # Copilot SDK wrapper, event forwarding
│   └── public/             # Static frontend (HTML/CSS/vanilla JS — no build step)
├── demos/                  # Demo script JSON files
├── docs/
│   └── ARCHITECTURE.md     # Detailed architecture reference
├── .github/
│   └── copilot-instructions.md  # Context for GitHub Copilot
├── package.json            # Node.js dependencies
├── host.json               # Azure Functions config (optional)
└── requirements.txt        # Python dependencies (optional)
```

## Demo Scripts

Demo scripts are JSON files located in the `demos/` directory. Each script defines a sequence of steps:

```json
{
  "steps": [
    {
      "type": "command",
      "text": "what can you help me with?",
      "typingSpeed": 45,
      "response": "I can help you with software engineering tasks..."
    },
    {
      "type": "question",
      "text": "create a REST API",
      "typingSpeed": 45,
      "question": {
        "message": "What framework would you like to use?",
        "schema": { ... }
      },
      "answer": "Express",
      "response": "I'll create an Express REST API..."
    }
  ]
}
```

## API Endpoints

### `GET /api/browse`
Browse directories for project selection
- Query param: `path` (optional, defaults to home directory)
- Returns: Directory listing with Git repository detection

### `GET /api/file`
Read file contents
- Query param: `path` (required)
- Returns: File content and metadata

### `GET /api/demos/:name`
Load a demo script
- Path param: `name` (demo script name without .json extension)
- Returns: Demo script JSON

## WebSocket Protocol

The WebSocket connection supports the following message types:

**Client → Server:**
- `create_session`: Initialize a new Copilot session
- `send_prompt`: Send a prompt to Copilot
- `user_input_response`: Respond to Copilot's questions
- `start_demo`: Start a scripted demo
- `cancel_demo`: Stop the current demo
- `abort`: Abort the current Copilot operation

**Server → Client:**
- `session_ready`: Session initialized successfully
- `delta`: Streaming text chunk from Copilot
- `message`: Complete message from Copilot
- `idle`: Copilot is ready for next input
- `tool_start`: Tool execution started
- `tool_complete`: Tool execution finished
- `intent`: Current task intent
- `file_changed`: File was modified
- `demo_step_command`: Demo command to display
- `demo_step_response`: Demo response to display
- `demo_step_question`: Show question dialog
- `demo_complete`: Demo finished
- `error`: Error occurred

## Security

- File browsing is restricted to the user's home directory
- Demo names are sanitized to prevent path traversal
- Only text-based files can be read via the file API
- WebSocket connections are validated before execution

## Azure Function

The included Azure Function provides a simple HTTP endpoint for demonstrations.

### Configuration

**Endpoint:** `/api/hello`  
**Method:** GET or POST  
**Parameters:** `name` (query string or JSON body)

### Local Testing

```bash
# Install Azure Functions Core Tools
# https://docs.microsoft.com/en-us/azure/azure-functions/functions-run-local

# Install Python dependencies
pip install -r requirements.txt

# Start the Azure Functions runtime
func start
```

### Example Usage

```bash
# GET request
curl "http://localhost:7071/api/hello?name=World"

# POST request
curl -X POST http://localhost:7071/api/hello \
  -H "Content-Type: application/json" \
  -d '{"name": "World"}'
```

**Response:**
```json
{
  "message": "Hello, World! This is your Azure Function."
}
```

### Deployment to Azure

```bash
# Login to Azure
az login

# Create a function app (one-time setup)
az functionapp create \
  --resource-group <resource-group> \
  --consumption-plan-location <location> \
  --runtime python \
  --runtime-version 3.9 \
  --functions-version 4 \
  --name <function-app-name> \
  --storage-account <storage-account>

# Deploy the function
func azure functionapp publish <function-app-name>
```

## Development

### TypeScript Compilation
The project uses `tsx` for TypeScript execution with hot reload during development.

### Adding New Demos
1. Create a JSON file in the `demos/` directory
2. Define the step sequence (commands and responses)
3. Load it via `/api/demos/:name`

## Dependencies

### Production
- `@github/copilot-sdk`: GitHub Copilot integration
- `express`: Web server framework
- `ws`: WebSocket server

### Development
- `typescript`: TypeScript compiler
- `tsx`: TypeScript execution
- `@types/express`: Express type definitions
- `@types/ws`: WebSocket type definitions

## Troubleshooting

### Common Issues

**Port already in use:**
```bash
# Change the port
PORT=8080 npm start
```

**WebSocket connection fails:**
- Ensure the server is running on `localhost:3456`
- Check browser console for detailed error messages
- Verify firewall settings allow WebSocket connections

**Copilot SDK errors:**
- Ensure you have GitHub Copilot CLI access
- Check your GitHub authentication: `gh auth status`
- Verify the `@github/copilot-sdk` package is installed

**Demo script not found:**
- Ensure the demo JSON file exists in the `demos/` directory
- Check the file name matches the API request (without .json extension)
- Verify the JSON syntax is valid

### Debug Mode

Enable verbose logging:
```bash
DEBUG=* npm start
```

## Roadmap

- [ ] Add more demo script templates
- [ ] Support for recording terminal sessions
- [ ] Export demos as video files
- [ ] Enhanced UI with syntax highlighting
- [ ] Multiple session management
- [ ] Custom themes and styling options

## License

MIT

## Contributing

Contributions are welcome! See **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for setup instructions, code style, security checklist, and PR guidelines.

## Support

For questions or issues:
- Open an [issue](../../issues)
- Check existing [discussions](../../discussions)
- Review the [GitHub Copilot documentation](https://docs.github.com/en/copilot)
