# cache-pill

A Claude Code plugin that shows how long your prompt cache has left. The pill sits in the prompt footer and changes color as the cache gets close to expiring. It reads the cache TTL from the session transcript.

It works in the Claude Code console (terminal) and in the Code tab of Claude Desktop. Your Claude Code build needs to support function-hook plugins.

## Install

Run these in a terminal:

```bash
claude plugin marketplace add VanillaFairy/agentic-plugins
claude plugin install cache-pill@vanillafairy
```

Then restart Claude Code or Claude Desktop. Both of them read the same plugin install, so you only need to do this once.

You can also use `/plugin marketplace add VanillaFairy/agentic-plugins` and then `/plugin install cache-pill@vanillafairy` from inside a console session.

## Tests

```bash
claude plugin test /path/to/cache-pill
```

## License

MIT. See [LICENSE](LICENSE).
