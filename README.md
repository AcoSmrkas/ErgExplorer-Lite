# ErgExplorer Lite

A version of [ErgExplorer](https://github.com/AcoSmrkas/ErgExplorer) that reads every piece of chain data
from an Ergo node the visitor picks. Static site, built with gulp and Nunjucks.

## The node

- It needs the extra index: `ergo.node.extraIndex = true`, synced from genesis (an archival node).
- The node's default `corsAllowedOrigin = "*"` is enough. A proxy in front must keep the CORS headers.
- A page served over https can only reach an https node, or one on the same computer
  (`http://localhost:9053`). For a plain-http node on your network, run the built site next to it.
- Page sizes stay at 100 or less, which some public nodes enforce.

## What talks to the network

Only `app/scripts/common/node.js` (`LiteNode`) fetches data, always from the selected node. ERG/USD comes
from the oracle pool box, token prices from Spectrum pool boxes, NFT data from minting boxes, all through
the node. NFT images and media load from wherever their links point.

`node tools/check-no-foreign-fetch.js` fails if any other script fetches, or a page loads a script, style
or font from another host. The build runs it first. Libraries are served from `app/vendor`, and a
Content-Security-Policy in the layout blocks other script, style and font hosts.

## Develop and build

- Install: `npm ci --ignore-scripts`
- Dev server: `npx gulp serve` (localhost:9014, or `PORT=90xx`; links use `#id` in dev)
- Build: `npx gulp build` (output in `dist/`)
- Token icons: thumbnails in `app/images/tokens/thumbs`; run `node tools/list-token-thumbs.js` after adding some.

## Run it next to your node

Serve `dist/` with any static web server that falls back to the page file for paths like
`/transactions/<id>`. The included `.htaccess` does this for Apache.
