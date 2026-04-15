Generate a comprehensive documentation file for the specified file or component, including a detailed description of its purpose, key features, technical specifications, usage instructions, and any relevant troubleshooting steps. Ensure the document is formatted for easy readability and includes clear headings and sections. Target the developers who will use the file. Be concise and do not include any unnecessary details.

Before generating documentation:

1. Review `README.md` for the project overview.
2. Review `index.js` and `Adapter.js` for the public API and the central class.
3. Check the actual source file for accuracy. There are no `.d.ts` files — read the JS.
4. Review existing wiki pages for consistent style and cross-references. Page filenames use `:` for the section separator (e.g., `Adapter:-CRUD-methods.md`).

If you document a function, include the following information in the "Technical specifications" section:

- Signature (all overloads if applicable)
- Full description of parameters, including optionality and defaults
- Return value (note: most Adapter methods are `async` and return promises)
- Additional exports (or attached helpers, e.g., `readList.byKeys`) and their descriptions

If you document a class, include the following information in the "Technical specifications" section:

- Constructor parameters
- Properties with types and descriptions
- Methods grouped by family (CRUD, batch builders, mass, generic, utilities)
- Hooks the consumer is expected to override (`prepare`, `revive`, `validateItem`, etc.)

Usage instructions should include:

- Import statement following project conventions: `const Adapter = require('dynamodb-toolkit')` or `const KoaAdapter = require('dynamodb-toolkit/helpers/KoaAdapter')` or `const xxx = require('dynamodb-toolkit/utils/xxx')`.
- A simple but representative use case.
- Show relevant methods and options in context.

Troubleshooting should include common issues and their solutions (e.g., DocumentClient vs raw DynamoDB differences, indirect indices, the `__delete` / `__separator` patch convention, the existence-check semantics of `post` vs `put`).

Cross-reference related components:

- Link to related API pages (e.g., `Adapter:-CRUD-methods` references `Adapter:-batch-methods` for the underlying `make*()` builders).
- Link to related utilities (e.g., `Adapter:-mass-methods` references `Utility:-paginateList`, `Utility:-readList`).
- Link to components commonly used together (e.g., `KoaAdapter` references `Adapter`).

Include a "See Also" section at the end with:

- Related API documentation links.
- Related utility documentation links.
- Links to related wiki pages (e.g., `General-ideas`, `Patching`, `Path`, `Batch-objects`, `Creating-client`).

When you generate links in a file located in the `wiki/` directory, use relative paths for wiki files and full paths for files located in the main repository. For example, link to the README as `https://github.com/uhop/dynamodb-toolkit/blob/master/README.md`. Always use `https://github.com/uhop/dynamodb-toolkit/blob/master/` for the main repository.

When you generate links in the main repository, use relative paths for other files in the same main repository and full paths for files located in the wiki directory. For example, use `https://github.com/uhop/dynamodb-toolkit/wiki/Adapter` for the `Adapter.md` file. Always use `https://github.com/uhop/dynamodb-toolkit/wiki/` for the wiki directory.

`wiki/Home.md` is the main page of the wiki. It should present the project overview and links to the main components (Adapter and its method families, KoaAdapter, the standalone utilities).
