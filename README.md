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

Download the zip from [Releases](https://github.com/AcoSmrkas/ErgExplorer-Lite/releases), unpack it and run

```
python3 serve.py
```

then open http://localhost:8080 and pick your node (`http://<node-ip>:9053` works from here).
`serve.py` answers paths like `/transactions/<id>` with the page file. On Apache, the included
`.htaccess` does the same. A release zip is `dist/` plus `serve.py`.
