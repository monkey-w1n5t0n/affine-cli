# AGENTS.md - Affine Skill CLI

## Project Overview

A command-line tool for Affine, used to manage Affine documents, tags, folders, collections, files, and more.

## Technical Documentation & Troubleshooting

You can use the deepwiki skill to access deepwiki documentation for detailed technical docs and troubleshooting.
Project knowledge base URL: https://deepwiki.com/toeverything/AFFiNE

## Code Conventions

- **Structured modularity**: Split functionality into independent modules
- **Common operations separated**: Generic authentication, GraphQL requests, WebSocket, and other operations are placed in the `utils/` directory
- **Core functionality separated**: The `core/` directory contains business logic, calling utility functions from utils
- **CLI commands decoupled**: The `cli/` directory handles only command-line argument parsing and result output, calling the core layer for actual functionality

## Core Commands

```bash
npm run build    # TypeScript compilation
npm run dev      # TypeScript watch mode
npm run start    # Run CLI (node dist/index.js)
npm run clean    # Clean dist directory
```

## CLI Usage

```
affine-cli <module> <operation> [options]

Modules: auth, workspace, doc, tags, folder, collection, file, database
Examples:
  affine-cli auth login
  affine-cli doc list --workspace <workspace-id>
  affine-cli doc create -t "Title" -c "./content.md"
```

## Configuration Loading Priority

**Environment variables > Local .env > Global ~/.affine-cli/affine-cli.env**

Key configuration items:

- `AFFINE_BASE_URL` - Affine server URL (default https://app.affine.pro)
- `AFFINE_API_TOKEN` - Authentication credentials
- `AFFINE_WORKSPACE_ID` - Default workspace ID

## Directory Structure

```
src/
├── cli/              # Command modules (auth, workspace, doc, tags, folder, collection, file)
│   └── One file per module, handles argument parsing and CLI output
├── core/             # Core business logic
│   ├── auth.ts       # Authentication core logic
│   ├── workspace.ts  # Workspace operations
│   ├── docs.ts       # Document operations
│   ├── tags.ts       # Tag operations
│   ├── folder.ts     # Folder operations
│   ├── collection.ts # Collection operations
│   └── file.ts       # File operations
└── utils/            # Utility functions
    ├── config.ts     # Configuration loading
    ├── auth.ts       # Authentication requests
    ├── graphqlClient.ts  # GraphQL request wrapper
    ├── wsClient.ts   # WebSocket client
    └── cliUtils.ts   # CLI utilities
```

## Notes

- Uses ES Module (`"type": "module"`)
- Build output goes to `dist/` directory
- Dependencies: `yjs`, `undici`, `socket.io-client`, `node-fetch`
