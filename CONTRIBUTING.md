# Contributing

Bug reports, feature ideas and pull requests are welcome.

## Reporting a bug

Open an [issue](https://github.com/Dzoukr/ExcalidrawMindmapObsidianPlugin/issues) with:

- what you did, what you expected and what happened instead
- your Obsidian and Excalidraw plugin versions, and whether it's desktop or mobile
- a small drawing that shows the problem, if you can share one

## Development

Requires Node.js 22 or later.

```
npm install
npm run dev     # watch build, copies into test-vault/.obsidian/plugins/excalidraw-mindmap
npm run build   # type-check + production build
npm test        # unit tests
npm run lint    # ESLint with Obsidian's plugin rules
```

Open `test-vault` in Obsidian with the Excalidraw plugin enabled to try your changes.

## Pull requests

- Keep a pull request to one change, and describe what it does and why.
- Make sure `npm run lint`, `npm test` and `npm run build` pass. CI runs them on every pull request.
- Follow Obsidian's [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines): use sentence case in the UI, no default hotkeys, and styles in `styles.css` rather than inline.
- Add or update tests in `test/` for layout, model and outline changes.
- Update the README when behaviour or settings change.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
