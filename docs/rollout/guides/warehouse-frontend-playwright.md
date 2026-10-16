# Warehouse frontend: how our Playwright specs are written

The team's rules for `/quality-code:write` on warehouse-frontend, read on top of the plugin's own
guide (these win where they differ). From `e2e/README.md` §3 and the old `/spec-frontend` skill.

## Fixtures and navigation

- **Import `test`, `expect` and `WORKSPACE_ID` from `../fixtures`** (or `../../fixtures` one folder
  down), never from `@playwright/test`. The raw `test` has no `warehouse` fixture and gives a blank page.
- **Open the screen with `await warehouse.goto('<route>')`**, never `page.goto`: the fixture does the
  token handshake, the tenant and the workspace. Routes are the app's: `/productsStock`,
  `/movementsList`, `/warehouseReports`, `/importStock`, `/warehouseManagement`, `/transferDdt`.
- Use `WORKSPACE_ID` from the fixtures, never the literal id.
- **The first assertion after `warehouse.goto` gets `{ timeout: 15_000 }`**: the shell boot is slow.
  Later ones keep the default.

## Stubs

- **Register every route before `warehouse.goto`.** The app fetches on mount.
- The shell endpoints (tenant, products, menu items, token) are already stubbed by the fixture: do not
  stub them again. Stub every **feature** endpoint the screen reads, or the request escapes to the
  real API:

  | Screen | Endpoints to stub |
  |---|---|
  | `/productsStock` | `**/trade-items/workspace/**`, `**/trade-items/*/workspace/**` (detail drawer), `**/warehouse/basic-info/**` |
  | `/movementsList` | `**/movements/workspace/**`, `**/movements/documents/workspace/**`, `**/movements/clients-suppliers/workspace/**`, `**/trade-items/**`, `**/warehouse/basic-info/**` |
  | `/warehouseReports` | `**/reports/**`, `**/historical-reports/**` |
  | `/importStock` | `**/adjustment-files/**`, `**/stock-files/**` |

- **Copy a response shape from an existing stub, never guess it**: the sibling spec in
  `e2e/tests/<screen folder>/`, else `e2e/tests/products-stock.smoke.spec.ts`. Trade items are
  `{ count, items: [{ id, code, name, measurementUnit, minimumStock, workspaceId, kpi: [{ stockOnHand,
  stockAvailability, stockValue, averageCost }] }] }`; the movements list is `{ data: [...], total }`; one
  movement is the body itself.
- **Order matters**: Playwright uses the last matching route, so register the broad list route first and
  the specific `…/<id>/workspace/**` ones after it.
- Money and quantities are decimal strings, as the API sends them (`"10.50"`).

## Texts and translations

- Serve the real label files, never hand-written strings: read
  `mocks/buckets/i18n/warehouse-app--{en,it}.json` with `readFileSync` and stub
  `await page.route('**/i18n/**', route => route.fulfill({ json: { item: BUCKET } }))`. That is what
  makes a missing translation show up.
- Our translation keys look like `NoDataFiltersMessage` or `MovementsTitle`. A screen that shows a raw
  key is broken: `await expect(page.getByText(/^[A-Z][a-z]+[A-Z][A-Za-z]*(Message|Title)$/)).toHaveCount(0)`.
- For one key text per screen, check both languages (`en` and `it`): the two files differ.

## Locators

- Roles and labels first. `.MuiDataGrid-root` and `.MuiDataGrid-row` are the accepted exceptions: the
  grid has no stable role.
