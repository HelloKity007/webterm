# File workspace visual baselines

These nine images are the accepted responsive layout baseline for the remote
file workspace. They were captured from the release-test candidate
`0d6d87295780aba9aae19bbb73ecc9a8120fc8db` on 2026-09-21.

The verifier captures Chromium, Firefox and WebKit at 375×812, 768×1024 and
1440×900. It masks only remote directory rows and the live path text because
they are operational data; the rendered navigation, toolbar, editor area,
empty state, borders, typography, responsive structure and overflow remain in
the comparison.

Run the comparison with:

```sh
WEBTERM_QA_OUTPUT=runtime/file-manager-visual-regression \
  node scripts/verify-file-manager-browsers.mjs
```

Updating a baseline is an explicit reviewed change, never an automatic test
fallback:

```sh
WEBTERM_QA_UPDATE_BASELINE=1 \
  node scripts/verify-file-manager-browsers.mjs
```
