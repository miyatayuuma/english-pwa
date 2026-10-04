# Offline source export only

Setup.gs creates the spreadsheet source schema; ExportItems.gs exports source rows into JSON chunks for manual data preparation. These scripts are not shipped in the PWA/native bundle and are not runtime dependencies. The app does not connect to Apps Script. Remote logging/WebApp and remote SRS scripts have been retired; all learning state stays in existing local authorities.
