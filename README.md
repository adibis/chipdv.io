# chipDV

Source for [chipdv.io](https://chipdv.io), a blog about design verification: UVM register (CSR)
verification, memory allocation (`uvm_mem_mam`), testbench architecture and reuse, firmware
verification, and where LLMs genuinely help (or quietly fail) at each of those jobs. Written by
[Aditya Shevade](https://chipdv.io/about), a working DV engineer.

## Building locally

Requires [Hugo](https://gohugo.io) extended (0.161.1+) and the theme submodule:

```
git submodule update --init --recursive
hugo server -D
```

## Deployment

Pushes to `master` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`. A daily
cron in that workflow also rebuilds the site on its own, so articles go live on their scheduled
`publishDate` without needing a same-day commit.

## License

The articles and diagrams (`content/`, `static/images/`, `data/`) are licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (see `LICENSE-CONTENT`): reuse them
freely, with credit to Aditya Shevade and a link to the original article. Everything else (Hugo
configuration, layouts, shortcodes, scripts) is MIT (see `LICENSE`). The Hextra theme in
`themes/hextra` keeps its own MIT license.

To cite the site or an article, see `CITATION.cff`, or use GitHub's "Cite this repository" button.
