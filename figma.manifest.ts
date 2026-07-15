export default {
  "name": "Iconsource",
  "id": "0000000000000000001",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "src/index.html",
  "editorType": ["figma", "dev"],
  "documentAccess": "dynamic-page",
  "menu": [
    { "command": "browse", "name": "Browse Icons…" },
    { "command": "check-updates", "name": "Check for Updates…" }
  ],
  "networkAccess": {
    "allowedDomains": ["https://api.iconify.design"],
    "reasoning": "Iconsource fetches icon search results, collection metadata (license/version/repo), and SVG data from the Iconify API so users can browse and import icons from open source libraries."
  }
}
