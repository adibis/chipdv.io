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

Pushes to `main` build and deploy to GitHub Pages via `.github/workflows/deploy.yml`. A daily
cron in that workflow also rebuilds the site on its own, so articles go live on their scheduled
`publishDate` without needing a same-day commit.

## License

Site content (articles, diagrams) is © Aditya Shevade, all rights reserved, unless a specific
article says otherwise. Site code (Hugo config, layouts, shortcodes) is provided as-is for
reference; no warranty.
