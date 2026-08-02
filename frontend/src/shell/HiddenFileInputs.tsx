/** Hidden file pickers — migrated verbatim from the pre-React web/index.html.
 *  They sit at body level because app.ts click()s them from several pages. */
export function HiddenFileInputs() {
  return (
    <>
    <input
      type="file"
      id="import-bundle-input"
      accept=".orchiday,.zip"
      style={{ display: "none" }}
      onChange={(event: any) => { App.onImportBundleFile(event) }}
    />
    <input
      type="file"
      id="import-model-input"
      accept=".orchiday,.zip"
      style={{ display: "none" }}
      onChange={(event: any) => { App.onImportModelFile(event) }}
    />
    </>
  );
}

import { App } from '../legacy/app';
