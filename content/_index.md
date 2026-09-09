---
title: chipDV
layout: hextra-home
---

<style>
  :root { --chipdv-home-dark: #18181b; }
  .hextra-nav-container-blur { background: var(--chipdv-home-dark) !important; }
  .hextra-nav-container nav { color: #d4d4d4; }
  .hextra-nav-container nav > a:first-child { color: #fff !important; }
  .hextra-nav-container nav a:hover { color: #fff !important; }
  .hextra-nav-container .hextra-search-input {
    background: rgba(255, 255, 255, 0.08) !important;
    color: #e5e5e5 !important;
  }
  .hextra-nav-container .hextra-search-input::placeholder { color: #a3a3a3 !important; }
  .hextra-nav-container kbd {
    background: rgba(255, 255, 255, 0.1) !important;
    color: #a3a3a3 !important;
    border-color: rgba(255, 255, 255, 0.15) !important;
  }

  /* Full-bleed hero: escapes <main>'s max-width wrapper entirely via 100vw,
     not just its padding, so it stays edge-to-edge on any screen width.
     100vw can include scrollbar-gutter width on some platforms, which would
     normally push this past the visible viewport and force a horizontal
     scrollbar; overflow-x:hidden on html/body (scoped to this page only,
     since this <style> block only ever renders on the homepage) kills that
     without capping the hero's actual width. <main>'s top padding is 2rem
     below md (768px) and 3rem at/above it; canceled here with a matching
     negative margin and no compensating padding, so the hero's background
     sits flush under the nav and the inner div's own padding is the only
     gap before the badge, instead of stacking on top of main's padding too. */
  html, body { overflow-x: hidden; }
  .chipdv-hero {
    width: 100vw;
    position: relative;
    left: 50%;
    transform: translateX(-50%);
    margin-top: -2rem;
  }
  @media (min-width: 768px) {
    .chipdv-hero { margin-top: -3rem; }
  }

  /* Hextra shows a redundant theme-toggle switcher in the footer specifically
     on pages with no sidebar (only the homepage), on top of the one already
     in the navbar. Hide that duplicate so the footer matches every other page. */
  .hextra-footer > div:has(.hextra-theme-toggle) { display: none; }
  .hextra-footer > div:has(.hextra-theme-toggle) + hr { display: none; }
</style>

<div class="not-prose chipdv-hero" style="background: var(--chipdv-home-dark); color: #fff;">
  <div style="max-width: 1400px; margin: 0 auto; padding: 3rem 3rem 2.75rem;">
    <span style="display: inline-flex; font: 600 0.6875rem var(--font-mono); color: #f2b84b; background: rgba(242, 184, 75, 0.14); border: 1px solid rgba(242, 184, 75, 0.35); padding: 0.3rem 0.6rem; border-radius: 20px; letter-spacing: 0.03em;">A GROWING REFERENCE FOR DV ENGINEERS</span>
    <h1 style="font: 700 clamp(2rem, 4.5vw, 3.125rem)/1.08 var(--font-sans); letter-spacing: -0.02em; margin: 1.25rem 0 0; max-width: 800px; color: #fff;">Real DV engineering, worked all the way through.</h1>
    <p style="font: 400 1.0625rem/1.55 var(--font-sans); color: #c4c4c4; max-width: 620px; margin: 1rem 0 0;">Register verification, memory allocation, SoC reuse patterns, and firmware verification -- four series that each work one testbench problem area all the way through, with real code, not a tutorial or a listicle.</p>
    <div style="display: flex; gap: 0.9rem; margin-top: 1.6rem; align-items: center; flex-wrap: wrap;">
      <a href="/csr" style="font: 600 0.875rem var(--font-sans); background: #df8e1d; color: #18181b; padding: 0.75rem 1.5rem; border-radius: 0.4rem; text-decoration: none;">Start with CSR Verification &rarr;</a>
      <a href="/projects/brokenbench/" style="font: 600 0.875rem var(--font-sans); color: #fff; border: 1px solid rgba(255, 255, 255, 0.3); padding: 0.7rem 1.4rem; border-radius: 0.4rem; text-decoration: none;">Try brokenbench &rarr;</a>
      <a href="https://github.com/adibis/brokenBench" target="_blank" rel="noopener noreferrer" style="font: 500 0.8125rem var(--font-sans); color: #a3a3a3; text-decoration: none;">View on GitHub</a>
      <a href="/about" style="font: 500 0.8125rem var(--font-sans); color: #a3a3a3; text-decoration: none;">by Aditya Shevade</a>
    </div>
  </div>
</div>

<div class="not-prose chipdv-fullbleed" style="padding: 2.5rem 0 0;">
  <div style="max-width: 1400px; margin: 0 auto; padding: 0 3rem;">
    <div class="chipdv-top-latest-grid">
      <div>
        <div class="chipdv-section-label" style="margin-bottom: 1rem;">TOP ARTICLES</div>
        {{< top-articles >}}
      </div>
      <div>
        <div class="chipdv-section-label" style="margin-bottom: 1rem;">LATEST ARTICLES</div>
        {{< latest-articles limit="5" >}}
      </div>
    </div>
  </div>
</div>

<div class="not-prose" style="max-width: 1400px; margin: 0 auto; padding: 2.75rem 0 0;">
  <div class="chipdv-section-label-row">
    <div class="chipdv-section-label">SERIES</div>
    <div class="chipdv-section-sublabel">{{< site-stats >}}</div>
  </div>
  {{< series-cards >}}
</div>

<div class="not-prose" style="max-width: 1400px; margin: 0 auto; padding: 2.25rem 0 0;">
  <div class="chipdv-section-label-row">
    <div class="chipdv-section-label">PROJECTS</div>
    <div class="chipdv-section-sublabel">Working code, not just writing</div>
  </div>
  {{< project-cards >}}
</div>

<div class="not-prose chipdv-fullbleed" style="margin-top: 2.75rem;">
  <div class="chipdv-subscribe-bar">
    <div>
      <div class="chipdv-subscribe-title">Get new articles by email</div>
      <div class="chipdv-subscribe-sub">No spam. One note when a new series or project lands.</div>
    </div>
    <div class="chipdv-subscribe-form">
      <input type="email" placeholder="you@company.com" disabled class="chipdv-subscribe-input" />
      <button type="button" disabled class="chipdv-subscribe-btn">Subscribe</button>
      <span class="chipdv-subscribe-note">COMING SOON &middot; use the <a href="/index.xml" class="chipdv-link-primary">RSS feed</a> for now</span>
    </div>
  </div>
</div>
