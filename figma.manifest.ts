export default {
  "name": "Iconsource",
  "id": "1660068674953897925",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "src/index.html",
  "editorType": ["figma", "dev"],
  "documentAccess": "dynamic-page",
  "menu": [
    { "command": "browse", "name": "Browse Icons…" },
    { "command": "check-updates", "name": "Check for Updates…" }
  ],
  "relaunchButtons": [
    { "command": "check-updates", "name": "Iconsource: Check for updates", "multipleSelection": true }
  ],
  "networkAccess": {
    "allowedDomains": ["https://api.iconify.design"],
    "reasoning": "Iconsource fetches icon search results, collection metadata (license/version/repo), and SVG data from the Iconify API so users can browse and import icons from open source libraries."
  }
}
