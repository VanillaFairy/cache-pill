# cache-pill

## Summary

A Claude Code plugin that puts a color-coded pill in the prompt footer with the time left before the session's prompt cache expires. It reads the cache TTL from the session transcript.

## Installation

You'll need a Claude Code build that supports function-hook plugins.

From the vanillafairy marketplace:

```
/plugin marketplace add VanillaFairy/agentic-plugins
/plugin install cache-pill@vanillafairy
```

To try a local clone in a single terminal session:

```bash
claude --plugin-dir /path/to/cache-pill
```

## Tests

```bash
claude plugin test /path/to/cache-pill
```

## License

MIT. See [LICENSE](LICENSE).
