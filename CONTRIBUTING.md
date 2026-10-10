# Working on EDU Test Manager

Favor readability over compactness. Keep behavior changes separate from readability refactors.

- Use braces for every `if`, `else`, and loop, including early returns.
- Put each declaration and statement on its own line. Let the formatter wrap long expressions and attributes.
- Use a single blank line between logical phases, such as validation, preparation, execution, cleanup, and returning a result. Keep related assignments and short guard clauses together; do not separate every statement. Keep comments attached to the block they explain.
- Name variables and functions for their purpose. Use short names only when their meaning is immediately clear, such as a loop index.
- Keep functions focused on one task. Extract a helper when it makes a sequence of steps easier to understand; avoid abstractions that merely hide a straightforward operation.
- Prefer guard clauses to deeply nested conditions. Make asynchronous cancellation, stale-result checks, and cleanup explicit.
- Explain reasons and invariants in comments, rather than narrating what a line of code does.
- Keep Drive file operations and email operations subject to the existing manual confirmation flow. Use fictional, generated documents and student lists for development; do not depend on a personal archive.

Run `npm run format` to format TypeScript, JavaScript, CSS, HTML, Markdown, and configuration files. The formatter also supports Vue files if introduced. Run `npm run format:check` and `npm run lint` to check formatting and control-flow style.

Before submitting changes, run `npm test` and `npm run build`. For visible UI changes, also check the application using `npm run uat` with the generated testing environment described in [README.md](README.md#verification). Synthetic results validate functionality, not accuracy on real exams.
