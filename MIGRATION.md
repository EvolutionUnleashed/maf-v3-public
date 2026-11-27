# Migration from an earlier edition

The desktop edition replaces the former hosted, account-scoped data model with one private local workspace stored in SQLite. Its first launch creates and migrates that workspace automatically.

## Recommended path

1. Back up the earlier database, exports, and media before changing anything.
2. Install and open the signed MAF V3 desktop application.
3. Add the required Intelligence API key in Settings.
4. Rebuild the strategic foundation or selectively copy only reviewed material from the earlier edition.

Do not point the desktop app at an old MySQL database. It neither needs nor reads `DATABASE_URL`.

## Existing data

Automatic conversion is deliberately not attempted. Older installations may contain several owners, incomplete BUILD rows, proprietary storage URLs, and authentication or billing records that have no desktop equivalent. Choosing the right former owner and handling missing media requires a reviewed migration.

If preserving earlier content is essential, keep the source read-only and import reviewed records into the equivalent SQLite tables:

- `build_sections`
- `build_sub_steps`
- `build_artifacts`
- `visual_identity`
- `create_outputs`
- `file_uploads`
- `content_engine_config`

Assign imported records to the single `workspaces` row. Copy referenced files into the desktop data folder's `media` directory and update stored URLs to `/media/...`. Close MAF V3 and take another full data-folder backup before using the converted workspace.
