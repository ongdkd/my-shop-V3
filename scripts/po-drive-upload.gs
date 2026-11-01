// Saves Purchase Orders LOG order screenshots into the shop's Google Drive folder.
// Google doesn't let the sheet's service account own files in a personal Drive, so this
// small script runs as the Drive's owner instead. The site reaches it through the
// sheets-sync Edge Function, never directly.
//
// Setup (about 2 minutes), signed in as the account that owns the folder:
//   1. script.google.com → New project → paste this file.
//   2. Project Settings → Script properties → add UPLOAD_KEY = any long random text.
//   3. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
//      Authorize when asked, then copy the Web app URL.
//   4. Supabase → Edge Functions → Secrets: PO_DRIVE_URL = that URL,
//      PO_DRIVE_KEY = the same text as UPLOAD_KEY.
var ROOT_FOLDER_ID = '1iYSVSgOaYb6hD-5joRd5CFdQkVZ9L_va';

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

// { key, month: "November 2026", name: "2026-11-02 Product.jpg", mime, base64 } → { url }
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var key = PropertiesService.getScriptProperties().getProperty('UPLOAD_KEY');
    if (!key || d.key !== key) return reply_({ error: 'Forbidden' });
    var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var found = root.getFoldersByName(d.month);
    var folder = found.hasNext() ? found.next() : root.createFolder(d.month);
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(d.base64), d.mime, d.name));
    return reply_({ url: file.getUrl() });
  } catch (err) {
    return reply_({ error: String(err && err.message || err) });
  }
}
