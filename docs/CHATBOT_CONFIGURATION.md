# AI Advisor Configuration

City Signal's **Chat with AI** tab is a server-side Azure Foundry integration. The browser never receives the provider key, endpoint, full prompt, or model configuration.

## Required `.env` Values

Set these in the repository-root `.env` file for local development, and use your hosting platform's secret manager in production:

```dotenv
CHATBOT_ENABLED=true
CHATBOT_PROVIDER=azure-foundry
CHATBOT_ENDPOINT=https://your-foundry-inference-host
CHATBOT_API_KEY=replace-with-your-secret-key
CHATBOT_MODEL_NAME=your-deepseek-deployment-or-model-name
```

`CHATBOT_ENDPOINT` is the Azure Foundry inference host/base URL, not a browser-facing value. `CHATBOT_MODEL_NAME` must match the DeepSeek model deployment or model name accepted by that endpoint.

## Optional Values

```dotenv
# Default: /openai/v1/chat/completions
CHATBOT_API_PATH=/openai/v1/chat/completions

# Set only when your Foundry endpoint requires an API version query parameter.
CHATBOT_API_VERSION=2024-05-01-preview

# Defaults: 12000 and 450
CHATBOT_TIMEOUT_MS=12000
CHATBOT_MAX_TOKENS=450

# Optional custom policy/instruction. The platform’s safety rules remain in force.
CHATBOT_SYSTEM_PROMPT="You are a concise learning assistant for Clash of the Cities- Mission Net Zero."
```

If your Foundry deployment provides a full chat-completions URL rather than a base URL, set `CHATBOT_API_PATH` to that full `https://.../chat/completions` URL. The code will use it directly and still requires `CHATBOT_ENDPOINT` to be present as the configured Foundry host.

## Runtime Behavior

1. An authenticated player sends a bounded question and up to eight local conversation messages to the API.
2. The API verifies game membership, applies per-user and per-IP limits, and records only safe usage metadata.
3. A lexical retrieval layer selects relevant game-mechanic knowledge chunks.
4. The API sends system rules, safe player context, retrieved knowledge, bounded history, and the current question to the Azure Foundry model.
5. The API returns a normalized reply plus source labels to the City Signal AI tab.

The model cannot execute game actions, change game state, access secrets, or bypass the authoritative API/worker rules.

## Disabled Development Mode

The default configuration is disabled:

```dotenv
CHATBOT_ENABLED=false
CHATBOT_PROVIDER=disabled
```

In disabled mode, the API returns a generic `503 CHATBOT_UNAVAILABLE` response. This prevents accidental external calls and keeps local development working before Foundry credentials are configured.
