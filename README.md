# Affine CLI

**[【English】](./README-en.md)** | **[【中文】](./README.md)**

Affine CLI is a lightweight command-line tool for managing Affine documents, tags, folders, collections, files, and databases. It provides a simplified interface for interacting with the Affine (<https://app.affine.pro>) API via the command line.

## Features

- **Authentication**: Login with email/password or API token
- **Workspace Management**: List and manage workspaces
- **Document Operations**: Create, read, update, delete, search, copy, and append content
- **Tag Management**: Create tags, add/remove tags from documents
- **Folder Management**: Organize documents in folders
- **Collection Management**: Create and manage collections
- **File Management**: Upload and manage file attachments
- **Comment Management**: Add, update, delete, and resolve comments
- **Database Management**: Create data tables, manage columns and rows

## Installation

### Local Install

```bash
# Clone the repository
git clone https://github.com/woodcoal/affine-cli.git
cd affine-cli

# Install dependencies
npm install

# Build the project
npm run build
```

### Global Install (Recommended)

```bash
# Install globally from npm (if published)
npm install -g affine-cli

# After installation, the affine-cli command is available from any directory
```

## Configuration

Create a `.env` file in the project directory, or use global configuration:

```bash
# Global config: ~/.affine-cli/affine-cli.env
# Local config: .env in the project directory

AFFINE_BASE_URL=https://app.affine.pro
AFFINE_API_TOKEN=your_api_token
AFFINE_WORKSPACE_ID=your_workspace_id
```

Configuration priority: environment variables > local `.env` > global `~/.affine-cli/affine-cli.env`

## Usage

```bash
# Authentication
affine-cli auth login
affine-cli auth status
affine-cli auth logout

# Workspaces
affine-cli workspace list

# Documents
affine-cli doc list --workspace <workspace-id>
affine-cli doc create -t "My Document" -c "./content.md"
affine-cli doc info --id <doc-id>
affine-cli doc delete --id <doc-id>
affine-cli doc search --query "keyword"

# Tags
affine-cli tags list
affine-cli tags create --tag "Important"
affine-cli tags add --id <doc-id> --tag "Important"
affine-cli tags remove --id <doc-id> --tag "Important"

# Folders
affine-cli folder all
affine-cli folder create --name "My Folder"
affine-cli folder list --id <folder-id>

# Collections
affine-cli collection list
affine-cli collection create --name "My Collection"

# Files
affine-cli file upload --file "./image.png"
affine-cli file list

# Comments
affine-cli comment list --doc-id <doc-id>
affine-cli comment create --doc-id <doc-id> --content "Good idea!"

# Databases
affine-cli database create --title "Task Table"
affine-cli database list --doc-id <doc-id>
affine-cli database columns --doc-id <doc-id> --db-id <db-id>
```

## Command Reference

### Auth Module (auth)

| Command     | Description                 | Parameters                                                                                                      |
| ----------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **login**   | Login with account or token | `--url` Server URL `--token` API Token `--workspace` Workspace ID `--local` Save locally `--force` Force overwrite |
| **logout**  | Logout                      | `--local` Delete local config                                                                                   |
| **status**  | Get login status            | `--json` JSON format output                                                                                     |

### Workspace Module (workspace)

| Command  | Description                     | Parameters                        |
| -------- | ------------------------------- | --------------------------------- |
| **list** | Get basic info for all workspaces | `--format` Output format (text/json) |

### Document Module (doc)

| Command        | Description                        | Parameters                                                                                                                |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **list**       | List workspace documents (paginated) | `--count` Page size `--skip` Offset `--after` Cursor `--workspace` Workspace ID                                          |
| **info**       | Get document details               | `--id` Document ID `--workspace` Workspace ID `--content` Content mode (markdown/raw/hidden)                              |
| **create**     | Create a new document              | `--title` Title `--content` Content `--file` Import from file `--folder` Folder ID `--tags` Tag list `--workspace` Workspace ID |
| **search**     | Search documents                   | `--query` Keyword `--workspace` Workspace ID `--count` Return count `--match-mode` Match mode `--tag` Tag filter          |
| **delete**     | Delete a document                  | `--id` Document ID `--workspace` Workspace ID                                                                             |
| **copy**       | Copy a document                    | `--id` Source document ID `--title` New title `--parent` Parent document ID `--folder` Target folder `--workspace` Workspace ID |
| **update**     | Update document properties         | `--id` Document ID `--title` Title `--parent` Parent document `--folder` Folder `--workspace` Workspace ID                |
| **replace**    | Replace document content           | `--id` Document ID `--search` Search text `--replace` Replacement text `--workspace` Workspace ID `--match-all` Replace all `--preview` Preview mode |
| **append**     | Append document content            | `--id` Document ID `--content` Content `--file` Import from file `--workspace` Workspace ID                               |
| **publish**    | Publish a document                 | `--id` Document ID `--workspace` Workspace ID                                                                             |
| **unpublish**  | Unpublish a document               | `--id` Document ID `--workspace` Workspace ID                                                                             |

### Tags Module (tags)

| Command     | Description                    | Parameters                                                        |
| ----------- | ------------------------------ | ------------------------------------------------------------------ |
| **list**    | List all tags                  | `--workspace` Workspace ID                                         |
| **create**  | Create a tag                   | `--tag` Tag name `--color` Color `--workspace` Workspace ID        |
| **add**     | Add tag to document            | `-d` Document ID `--tag` Tag name `--workspace` Workspace ID       |
| **remove**  | Remove tag from document       | `-d` Document ID `--tag` Tag name `--workspace` Workspace ID       |
| **delete**  | Delete a tag                   | `--tag` Tag name `--workspace` Workspace ID                        |
| **info**    | Get documents associated with a tag | `--tag` Tag name `--workspace` Workspace ID `--ignore-case` Ignore case |

### Folder Module (folder)

| Command     | Description                  | Parameters                                                                                         |
| ----------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| **all**     | List all folders             | `--workspace` Workspace ID                                                                         |
| **list**    | List folder contents         | `--id` Folder ID `--folder` Folders only `--workspace` Workspace ID                                |
| **create**  | Create a folder              | `--name` Folder name `--parent` Parent folder ID `--index` Sort index `--workspace` Workspace ID   |
| **delete**  | Delete a folder              | `--id` Folder ID `--workspace` Workspace ID                                                        |
| **update**  | Update folder properties     | `--id` Folder ID `--name` Name `--parent` Parent folder `--index` Sort order `--workspace` Workspace ID |
| **clear**   | Remove empty folders         | `--workspace` Workspace ID                                                                         |
| **add**     | Add document to folder       | `--id` Folder ID `--doc` Document ID `--index` Sort order `--workspace` Workspace ID               |
| **move**    | Move document to target folder | `--id` Target folder ID `--doc` Document ID `--workspace` Workspace ID                          |
| **remove**  | Remove document from folder  | `--id` Folder ID `--doc` Document ID `--workspace` Workspace ID                                    |

### Collection Module (collection)

| Command     | Description                | Parameters                                                    |
| ----------- | -------------------------- | ------------------------------------------------------------- |
| **list**    | List all collections       | `--workspace` Workspace ID                                    |
| **info**    | List documents in collection | `--id` Collection ID `--workspace` Workspace ID             |
| **create**  | Create a collection        | `--name` Collection name `--workspace` Workspace ID           |
| **update**  | Update collection name     | `--id` Collection ID `--name` New name `--workspace` Workspace ID |
| **delete**  | Delete a collection        | `--id` Collection ID `--workspace` Workspace ID               |
| **add**     | Add document to collection | `--id` Collection ID `--doc` Document ID `--workspace` Workspace ID |
| **remove**  | Remove document from collection | `--id` Collection ID `--doc` Document ID `--workspace` Workspace ID |

### File Module (file)

| Command     | Description            | Parameters                                                                                                          |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **upload**  | Upload an attachment   | `--file` File path `--content` Base64 content `--filename` File name `--content-type` MIME type `--workspace` Workspace ID |
| **delete**  | Delete an attachment   | `--id` Attachment ID `--permanently` Permanent delete `--workspace` Workspace ID                                    |
| **clean**   | Clean deleted attachments | `--workspace` Workspace ID                                                                                       |

### Comment Module (comment)

| Command      | Description           | Parameters                                                                                                                    |
| ------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **list**     | List document comments | `--doc-id` Document ID `--workspace` Workspace ID `--first` Return count `--offset` Offset `--full` Full data              |
| **create**   | Create a comment       | `--doc-id` Document ID `--content` Comment content `--workspace` Workspace ID `--selection` Quoted text `--doc-title` Document title `--doc-mode` Document mode |
| **update**   | Update a comment       | `--id` Comment ID `--content` New content                                                                                     |
| **delete**   | Delete a comment       | `--id` Comment ID `--workspace` Workspace ID `--doc-id` Document ID                                                           |
| **resolve**  | Resolve/unresolve     | `--id` Comment ID `--resolved` true/false                                                                                     |

### Database Module (database)

| Command     | Description              | Parameters                                                                                                                    |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **list**    | List databases in a document | `--doc` Document ID `--workspace` Workspace ID                                                                           |
| **columns** | Read column definitions  | `--doc` Document ID `--id` Database ID `--workspace` Workspace ID                                                             |
| **query**   | Query data               | `--doc` Document ID `--id` Database ID `--rows` Row ID list `--columns` Column name list `--query` Filter condition `--full` Full output `--workspace` Workspace ID |
| **remove**  | Delete rows              | `--doc` Document ID `--id` Database ID `--row` Row ID `--query` Filter condition `--workspace` Workspace ID                    |
| **update**  | Update rows              | `--doc` Document ID `--id` Database ID `--values` Cell data `--row` Row ID `--query` Filter condition `--workspace` Workspace ID |
| **create**  | Create a database        | `--content` Data (JSON) `--doc` Document ID `--title` Title `--view-mode` View mode `--workspace` Workspace ID                 |
| **delete**  | Delete a database        | `--doc` Document ID `--id` Database ID `--workspace` Workspace ID                                                             |
| **insert**  | Insert data              | `--doc` Document ID `--id` Database ID `--content` Data `--workspace` Workspace ID                                             |

## Command Help

```bash
# Show main help
affine-cli help

# Show module help
affine-cli doc --help

# Show specific command help
affine-cli doc create --help
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── cli/                # CLI command modules
│   ├── auth.ts
│   ├── workspace.ts
│   ├── doc.ts
│   ├── tags.ts
│   ├── folder.ts
│   ├── collection.ts
│   ├── file.ts
│   ├── comments.ts
│   └── database.ts
├── core/               # Core business logic
│   ├── auth.ts
│   ├── workspace.ts
│   ├── docs.ts
│   ├── tags.ts
│   ├── folder.ts
│   ├── collection.ts
│   ├── file.ts
│   ├── comments.ts
│   ├── database.ts
│   └── constants.ts
└── utils/              # Utility functions
    ├── config.ts
    ├── auth.ts
    ├── graphqlClient.ts
    ├── wsClient.ts
    ├── cliUtils.ts
    ├── docsUtil.ts
    ├── fileConverter.ts
    └── misc.ts
```

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js
- **GraphQL Client**: undici
- **WebSocket**: socket.io-client
- **CRDT**: Yjs

## Acknowledgements

This project references the implementation of [dawncr0w/affine-mcp-server](https://github.com/dawncr0w/affine-mcp-server). We thank the original author for laying the foundation.

## License

MIT © [The AFFiNE CLI Contributors](LICENSE) & [woodcoal](https://github.com/woodcoal/affine-cli) <woodcoal@qq.com>

## Author

- **Author**: woodcoal
- **Email**: <woodcoal@qq.com>
- **GitHub**: <https://github.com/woodcoal/affine-cli>
