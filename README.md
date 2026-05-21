# OnePage CRM MCP Server

This is a small MCP server that lets ChatGPT or another MCP client use a safe set of OnePage CRM tools.

It exposes only:

- `search_contacts`
- `get_contact`
- `list_tasks`
- `create_task`
- `add_note`
- `mark_task_done`

## Important Assumptions

I checked the current OnePage CRM Swagger docs before building this. OnePage CRM calls tasks / next actions **Actions** in the API.

- Authentication uses HTTP Basic Auth with `user_id` as the username and `api_key` as the password.
- The default API server is `https://app.onepagecrm.com/api/v3`.
- Contacts are available through `/contacts`.
- Tasks / next actions are available through `/actions`.
- Notes are available through `/notes` and `/contacts/{contact_id}/notes`.
- Marking a task done is supported by updating an action with `done=true`.
- Contact email search uses OnePage CRM's `email` filter. If `search_contacts` receives a query containing `@`, this server treats it as an email search.

Sources:

- OnePage CRM API docs: https://developer.onepagecrm.com/api/
- OnePage CRM Swagger file: https://github.com/OnePageCRM/swagger/blob/master/swagger.yaml
- OnePage CRM API key help: https://help.onepagecrm.com/article/441-does-onepagecrm-have-an-api
- OpenAI MCP guide: https://developers.openai.com/api/docs/mcp
- ChatGPT developer mode guide: https://developers.openai.com/api/docs/guides/developer-mode

This project uses `@modelcontextprotocol/sdk` `1.29.0`, which is newer than the `1.26.0` release that fixed a known shared transport/server security issue.

## What You Need

You need these three values from OnePage CRM:

- Endpoint URL
- User ID
- API Key

You also need Node.js version 20 or newer.

## Install Node.js

If Node.js is not already installed:

1. Open https://nodejs.org/
2. Click the button for the **LTS** version.
3. Open the downloaded installer.
4. Keep clicking **Next** until the installer finishes.
5. Close and reopen your terminal.

## Where To Find Your OnePage CRM Details

1. Open OnePage CRM in your browser.
2. Click your profile icon in the top-right corner.
3. Click **Apps and Integrations**.
4. Under **Utilities**, click **API**.
5. Click the **Configuration** tab.
6. Copy the **Endpoint URL**, **User ID**, and **API Key**.

Do not paste these into ChatGPT. Put them only in the `.env` file or your deployment provider's environment variables.

## Local Setup

Open a terminal in this folder, then copy and paste:

```bash
npm install
```

Create your private settings file:

Windows:

```bash
copy .env.example .env
```

Mac or Linux:

```bash
cp .env.example .env
```

Open the new `.env` file and replace the placeholder values:

```bash
ONEPAGECRM_ENDPOINT=https://app.onepagecrm.com/api/v3
ONEPAGECRM_USER_ID=paste_your_user_id_here
ONEPAGECRM_API_KEY=paste_your_api_key_here
MCP_TRANSPORT=http
PORT=3000
```

Save the file.

## Test Whether It Works

Copy and paste:

```bash
npm run test:connection
```

If it works, you will see:

```text
Connection OK. OnePage CRM accepted the endpoint, user ID, and API key.
```

If it fails, check the troubleshooting section below.

## Run Locally

For a local web server:

```bash
npm run dev:http
```

You should see a message that the server is listening on:

```text
http://localhost:3000
```

The MCP URLs are:

- Streamable HTTP: `http://localhost:3000/mcp`
- SSE fallback: `http://localhost:3000/sse`

To check that the local web server is awake, open this in your browser:

```text
http://localhost:3000/health
```

ChatGPT on the web usually cannot connect to `localhost` on your computer. For ChatGPT, deploy the server first, then use the deployed URL.

## Connect To ChatGPT

ChatGPT custom MCP connections use a remote server URL. OpenAI's current docs say ChatGPT developer mode supports Streamable HTTP and SSE.

Use this URL after deployment:

```text
https://your-deployed-app.example.com/mcp
```

If the setup screen specifically asks for an SSE URL, use:

```text
https://your-deployed-app.example.com/sse
```

Typical ChatGPT steps:

1. Open ChatGPT.
2. Open **Settings**.
3. Go to **Apps**.
4. Open **Advanced settings**.
5. Turn on **Developer mode**.
6. Go back to Apps settings.
7. Click **Create app**.
8. Paste your deployed MCP URL.
9. Save it.
10. In a chat, choose **Developer mode** and select the app.

Start by testing read-only tools first: `search_contacts`, `get_contact`, and `list_tasks`.

## Example MCP Config

Some local MCP clients use a JSON config. Build first:

```bash
npm run build
```

Then use a config like this, changing the folder path and credential values:

```json
{
  "mcpServers": {
    "onepagecrm": {
      "command": "node",
      "args": ["C:\\path\\to\\onepagecrm-mcp-server\\dist\\index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "ONEPAGECRM_ENDPOINT": "https://app.onepagecrm.com/api/v3",
        "ONEPAGECRM_USER_ID": "paste_your_user_id_here",
        "ONEPAGECRM_API_KEY": "paste_your_api_key_here"
      }
    }
  }
}
```

For OpenAI API MCP usage, the remote tool config looks like:

```json
{
  "type": "mcp",
  "server_label": "onepagecrm",
  "server_url": "https://your-deployed-app.example.com/mcp",
  "allowed_tools": [
    "search_contacts",
    "get_contact",
    "list_tasks",
    "create_task",
    "add_note",
    "mark_task_done"
  ],
  "require_approval": "always"
}
```

## Deploy

## Render deployment

This repo is now structured so Render can build from the repository root. The root contains `Dockerfile`, `package.json`, `tsconfig.json`, `render.yaml`, and the `src/` folder.

In Render, create a **Web Service** and choose **Docker**. Render should use:

```text
Dockerfile path: ./Dockerfile
Docker build context: .
```

Add these environment variables in Render:

```text
ONEPAGECRM_ENDPOINT
ONEPAGECRM_USER_ID
ONEPAGECRM_API_KEY
```

After deployment, use this MCP endpoint:

```text
https://your-render-service-name.onrender.com/mcp
```

If your MCP setup asks specifically for an SSE URL instead, use:

```text
https://your-render-service-name.onrender.com/sse
```

### Render

1. Push this folder to a private GitHub repository.
2. Open Render.
3. Click **New**.
4. Click **Web Service**.
5. Pick your GitHub repository.
6. Set **Build Command** to:

```bash
npm install && npm run build
```

7. Set **Start Command** to:

```bash
npm run start:http
```

8. Add these environment variables in Render:

```text
ONEPAGECRM_ENDPOINT
ONEPAGECRM_USER_ID
ONEPAGECRM_API_KEY
MCP_TRANSPORT=http
```

Render usually provides `PORT` automatically. Only add `PORT` if Render specifically asks for it.

9. Deploy.
10. Copy the Render URL and add `/mcp` to the end.

### Railway

1. Push this folder to a private GitHub repository.
2. Open Railway.
3. Click **New Project**.
4. Choose **Deploy from GitHub repo**.
5. Add the same environment variables listed above.
6. Railway should run the Node app automatically. If it asks, use:

```bash
npm run start:http
```

7. Copy the public URL and add `/mcp` to the end.

Railway usually provides `PORT` automatically. Only add `PORT` if Railway specifically asks for it.

### Docker

```bash
docker build -t onepagecrm-mcp-server .
docker run --env-file .env -p 3000:3000 onepagecrm-mcp-server
```

## Security Notes

- Never commit `.env`.
- Never paste your API key into ChatGPT.
- Rotate the OnePage CRM API key if it is exposed. In OnePage CRM, go to the API Configuration tab and generate a new API key.
- Use a dedicated OnePage CRM user for this integration if your account setup allows it.
- In ChatGPT, turn off write tools until you are ready to use them.
- Treat `create_task`, `add_note`, and `mark_task_done` as write actions.
- If you deploy this on a public URL, do not share the URL widely. For production teams, put the server behind an OAuth-capable gateway or another access control layer.
- This server supports an optional `MCP_BEARER_TOKEN`, but only use it with MCP clients or gateways that can send an `Authorization: Bearer ...` header.

## Troubleshooting

### `Connection failed: Missing required environment variable`

Your `.env` file is missing a value. Open `.env` and make sure all three OnePage CRM values are filled in.

### `OnePage CRM rejected the credentials`

Check that you copied the **User ID** and **API Key**, not your email address and password.

### `OnePage CRM could not be reached`

Check the endpoint URL. It usually looks like:

```text
https://app.onepagecrm.com/api/v3
```

### ChatGPT cannot connect

Make sure you are using the deployed public URL, not `localhost`.

Use:

```text
https://your-deployed-app.example.com/mcp
```

If the setup asks for SSE, use:

```text
https://your-deployed-app.example.com/sse
```

### A write action is scary

That is healthy. Start with `search_contacts`, `get_contact`, and `list_tasks`. Turn on write tools only after you have tested with a safe contact.
