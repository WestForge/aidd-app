# AIDD App Starter

Electron + React + TypeScript starter for the AIDD workflow app.

## Current flow

1. Create/open a project.
2. Complete the Project Foundation.
3. Define Standards using guided options.
4. Choose a path:
   - start with Capabilities when you know what the system should do;
   - start with Components when you know the software architecture shape.
5. Use Delivery Packages for controlled technical increments.
6. Use AI Reviews to review AI output before verification.

## Run

```bash
npm install
npm run dev
```

## Notes

- Git is hidden from product-owner screens.
- Sync is intended to be built into save/review actions rather than exposed as a standalone left-menu item.
- Markdown files carry workflow status in frontmatter.
- App appearance supports Follow OS, Light, and Dark modes.


## v0.7 editor update

The app now includes a reusable `AiddMarkdownEditor` wrapper using TOAST UI Editor. It defaults to visual/WYSIWYG editing while keeping a Markdown mode available for technical users. Frontmatter remains app-owned and is not edited directly in the editor.


## v0.7.1

Replaced `@toast-ui/react-editor` with the core `@toast-ui/editor` package to avoid the React 17 peer dependency conflict when using React 18.
