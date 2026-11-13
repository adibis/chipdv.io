// Full-screen player for playable diagrams (layouts/_shortcodes/flow.html).
// The page holds a static figure; Play opens a <dialog> "theater" with the
// diagram on a stage, the caption and header fields in a side rail, and the
// transport along the bottom. A figure marked data-inline plays in place
// instead, in the same theater laid out as a column. Each step's look is derived from its index
// alone, so Prev, Next, the scrubber, and deep links all render the same
// state; animation only covers the move into a step.
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var TRAVEL_MS = 1100;
  var DWELL_MS = 2600;
  var CAMERA_MS = 650;
  var MAX_ZOOM = 1.1;       // screen px per diagram unit when following
  var FOLLOW_BELOW = 0.85;  // follow by default when the whole diagram fits smaller than this
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var ICON = {
    restart: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
    prev: '<path d="M16 5v14L5 12z"/>',
    next: '<path d="M6 5v14l9-7zM16 5h2v14h-2z"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
    close: '<path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/>',
    fit: '<path d="M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z"/>',
    expand: '<path d="M14 3h7v7h-2V6.4l-5.3 5.3-1.4-1.4L17.6 5H14zM3 14h2v3.6l5.3-5.3 1.4 1.4L6.4 19H10v2H3z"/>',
    follow: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 3h-2.1A7 7 0 0 0 13 5.1V3h-2v2.1A7 7 0 0 0 5.1 11H3v2h2.1a7 7 0 0 0 5.9 5.9V21h2v-2.1a7 7 0 0 0 5.9-5.9H21z"/>',
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' + ICON[name] + "</svg>";
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // ------------------------------------------------------------------ flows

  // One per figure on the page: the flow's data, read once.
  function Flow(fig) {
    this.fig = fig;
    this.id = fig.getAttribute("data-flow-id");
    this.data = JSON.parse(fig.querySelector('script[type="application/json"]').textContent);
    this.steps = this.data.steps;
    this.svgSource = fig.querySelector("template.dv-flow-svg").innerHTML;
    var items = fig.querySelectorAll(".dv-flow-steps li");
    this.text = Array.prototype.map.call(items, function (li) {
      var t = li.querySelector(".dv-flow-li-text");
      var a = li.querySelector("a.dv-flow-chapter");
      return {
        caption: t ? t.innerHTML : "",
        chapterHref: a ? a.getAttribute("href") : null,
        chapterTitle: a ? a.textContent : null,
      };
    });
    // Scenes: the steps from one `scene:` up to the next.
    var scenes = [], cur = null;
    this.steps.forEach(function (s, i) {
      if (s.scene || !cur) {
        cur = { title: s.scene || "", role: s.role || "", start: i, steps: [] };
        scenes.push(cur);
      }
      cur.steps.push(i);
      s._scene = scenes.length - 1;
    });
    this.scenes = scenes;
  }

  Flow.prototype.sceneOf = function (i) {
    return this.scenes[this.steps[i]._scene];
  };

  // --------------------------------------------------------------- theater

  // With a host element the theater is built inline in it, already open, and
  // never touches the page's history or scroll; otherwise it's a dialog.
  function Theater(host) {
    this.inline = !!host;
    var d = el(host ? "div" : "dialog", host ? "dv-theater dv-theater-inline" : "dv-theater");
    d.setAttribute("aria-label", "Playable diagram");
    d.innerHTML =
      '<div class="th-shell">' +
      '<header class="th-head"><div class="th-title"></div><div class="th-tools">' +
      '<button type="button" class="th-tool" data-act="follow" aria-pressed="false" title="Follow the action (F)">' + icon("follow") + "<span>Follow</span></button>" +
      '<button type="button" class="th-tool" data-act="fit" title="Show the whole diagram (0)">' + icon("fit") + "<span>Fit</span></button>" +
      (host ? '<button type="button" class="th-tool" data-act="expand" title="Full screen">' + icon("expand") + "<span>Full screen</span></button>" : "") +
      '<button type="button" class="th-tool th-close" data-act="close" aria-label="Close" title="Close (Esc)">' + icon("close") + "</button>" +
      "</div></header>" +
      '<div class="th-stage"><div class="th-role" hidden></div><div class="th-canvas dv-themed-svg"></div>' +
      '<button type="button" class="th-recenter" data-act="recenter" hidden>Recenter</button></div>' +
      '<aside class="th-rail">' +
      '<div class="th-eyebrow"><span class="th-scene"></span><span class="th-count"></span></div>' +
      '<div class="th-condition" hidden></div>' +
      '<div class="th-parallel" hidden><span class="th-parallel-h">In parallel</span><ul></ul></div>' +
      '<div class="th-caption" aria-live="polite"></div>' +
      '<a class="th-chapter" hidden></a>' +
      '<div class="th-predict" hidden><div class="th-predict-label">Before you go on</div><div class="th-predict-q"></div></div>' +
      '<details class="th-inspector" hidden open><summary></summary><div class="th-ribbon"></div><div class="th-fields"></div></details>' +
      "</aside>" +
      '<footer class="th-transport">' +
      '<div class="th-buttons">' +
      '<button type="button" class="th-btn" data-act="restart" aria-label="First step" title="First step (Home)">' + icon("restart") + "</button>" +
      '<button type="button" class="th-btn" data-act="prev" aria-label="Previous step" title="Previous (&larr;)">' + icon("prev") + "</button>" +
      '<button type="button" class="th-btn th-next" data-act="next" aria-label="Next step" title="Next (&rarr;)">' + icon("next") + "<span>Next</span></button>" +
      '<button type="button" class="th-btn th-play" data-act="play" aria-label="Autoplay" title="Autoplay (Space)">' + icon("play") + "</button>" +
      '<button type="button" class="th-btn th-speed" data-act="speed" title="Autoplay speed">1&times;</button>' +
      "</div>" +
      '<div class="th-scrubber" role="group" aria-label="Steps"></div>' +
      "</footer></div>";
    (host || document.body).appendChild(d);
    if (host) d.tabIndex = 0;
    this.d = d;
    var q = function (s) { return d.querySelector(s); };
    this.titleEl = q(".th-title");
    this.stage = q(".th-stage");
    this.canvas = q(".th-canvas");
    this.roleEl = q(".th-role");
    this.recenterBtn = q(".th-recenter");
    this.followBtn = q('[data-act="follow"]');
    this.sceneEl = q(".th-scene");
    this.countEl = q(".th-count");
    this.condEl = q(".th-condition");
    this.parEl = q(".th-parallel");
    this.parList = q(".th-parallel ul");
    this.captionEl = q(".th-caption");
    this.chapterEl = q(".th-chapter");
    this.predictEl = q(".th-predict");
    this.predictQ = q(".th-predict-q");
    this.insp = q(".th-inspector");
    this.inspLabel = q(".th-inspector summary");
    this.ribbon = q(".th-ribbon");
    this.fields = q(".th-fields");
    this.playBtn = q(".th-play");
    this.speedBtn = q(".th-speed");
    this.scrubber = q(".th-scrubber");

    this.flow = null;
    this.index = 0;
    this.playing = false;
    this.speed = 1;
    this.timer = null;
    this.tokenFrame = null;
    this.camFrame = null;
    this.pushed = false;
    this.follow = null;   // null = automatic, true/false = reader's choice
    this.manual = false;

    d.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (b) this.act(b.getAttribute("data-act"));
    }.bind(this));
    d.addEventListener("cancel", function (e) {
      e.preventDefault();
      this.close();
    }.bind(this));
    d.addEventListener("keydown", this.onKey.bind(this));
    window.addEventListener("resize", function () {
      if (this.isOpen()) this.camera(false);
    }.bind(this));
    window.addEventListener("popstate", function () {
      if (!this.inline && d.open && !this.hashMatches()) this.close(true);
    }.bind(this));
    this.bindPanZoom();
    this.bindSwipe();
  }

  Theater.prototype.isOpen = function () {
    return this.inline ? !!this.flow : this.d.open;
  };

  Theater.prototype.hashMatches = function () {
    return this.flow && location.hash.indexOf("#flow-" + this.flow.id + "=") === 0;
  };

  Theater.prototype.open = function (flow, step, fromHash) {
    this.flow = flow;
    this.follow = this.inline ? false : null;  // an inline pane is too small to follow in
    this.manual = false;
    this.titleEl.textContent = flow.data.title;
    this.d.setAttribute("aria-label", "Playable diagram: " + flow.data.title);
    this.mountSvg(flow);
    this.buildScrubber(flow);
    this.insp.open = window.innerWidth >= 760;
    this.index = Math.max(0, Math.min(step, flow.steps.length - 1));
    if (this.inline) {
      this.render(false, true);
      return;
    }
    document.documentElement.classList.add("dv-theater-open");
    if (!this.d.open) this.d.showModal();
    var hash = "#flow-" + flow.id + "=" + (this.index + 1);
    if (fromHash) {
      this.pushed = false;
    } else {
      history.pushState({ dvFlow: flow.id }, "", location.pathname + location.search + hash);
      this.pushed = true;
    }
    this.render(false, true);
    this.d.querySelector(".th-next").focus();
  };

  // popped: the browser already left the flow's history entry (Back button).
  Theater.prototype.close = function (popped) {
    if (this.inline || !this.d.open) return;
    this.pause();
    cancelAnimationFrame(this.tokenFrame);
    cancelAnimationFrame(this.camFrame);
    this.d.close();
    document.documentElement.classList.remove("dv-theater-open");
    if (!popped) {
      if (this.pushed) history.back();
      else history.replaceState(null, "", location.pathname + location.search);
    }
    this.pushed = false;
    var opener = this.flow && this.flow.fig.querySelector(".dv-flow-open");
    if (opener) opener.focus();
  };

  Theater.prototype.mountSvg = function (flow) {
    this.canvas.innerHTML = flow.svgSource;
    var svg = this.canvas.querySelector("svg");
    svg.classList.add("th-svg");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    this.svg = svg;
    var vb = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
    this.full = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    this.vb = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    this.els = {};
    Array.prototype.forEach.call(
      svg.querySelectorAll('g[id^="block-"], g[id^="arrow-"]'),
      function (g) {
        g.classList.add("flow-part");
        this.els[g.id] = g;
      }, this);
    this.tokens = [];
    this.recapLayer = svgEl("g", { "class": "flow-recap" });
    svg.appendChild(this.recapLayer);
  };

  Theater.prototype.buildScrubber = function (flow) {
    var s = this.scrubber;
    s.innerHTML = "";
    this.cells = [];
    flow.scenes.forEach(function (sc) {
      var seg = el("div", "th-seg");
      seg.style.flexGrow = sc.steps.length;
      seg.appendChild(el("div", "th-seg-label", sc.title || " "));
      var row = el("div", "th-seg-cells");
      sc.steps.forEach(function (i) {
        var c = el("button", "th-cell");
        c.type = "button";
        c.setAttribute("aria-label", "Step " + (i + 1));
        c.addEventListener("click", function () { this.pause(); this.go(i, false); }.bind(this));
        row.appendChild(c);
        this.cells[i] = c;
      }, this);
      seg.appendChild(row);
      s.appendChild(seg);
    }, this);
  };

  // ---------------------------------------------------------------- input

  Theater.prototype.act = function (what) {
    switch (what) {
      case "close": return this.close();
      case "expand":
        this.pause();
        return getTheater().open(this.flow, this.index, false);
      case "play": return this.playing ? this.pause() : this.play();
      case "speed":
        this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1;
        this.speedBtn.innerHTML = (this.speed === 0.5 ? "&frac12;" : this.speed) + "&times;";
        return;
      case "fit":
        this.follow = false;
        this.manual = false;
        return this.camera(true);
      case "follow":
        this.follow = !this.followOn();
        this.manual = false;
        return this.camera(true);
      case "recenter":
        this.manual = false;
        return this.camera(true);
    }
    this.pause();
    var last = this.flow.steps.length - 1;
    if (what === "restart") this.go(0, false);
    else if (what === "end") this.go(last, false);
    else if (what === "prev") this.go(Math.max(this.index - 1, 0), false);
    else if (what === "next") this.go(Math.min(this.index + 1, last), true);
  };

  Theater.prototype.onKey = function (e) {
    if (e.target.closest("a, button, summary") && (e.key === " " || e.key === "Enter")) return;
    var map = {
      ArrowRight: "next", ArrowLeft: "prev", " ": "play", Home: "restart", End: "end",
      f: "follow", F: "follow", "0": "fit",
    };
    if (map[e.key]) {
      this.act(map[e.key]);
    } else if (e.key === "+" || e.key === "=" || e.key === "-") {
      var r = this.stage.getBoundingClientRect();
      this.zoomAt(e.key === "-" ? 1.25 : 0.8, r.left + r.width / 2, r.top + r.height / 2);
    } else {
      return;
    }
    e.preventDefault();
  };

  Theater.prototype.bindPanZoom = function () {
    var stage = this.stage, self = this;
    var pointers = {}, last = null, pinch = null, moved = false;
    stage.addEventListener("wheel", function (e) {
      e.preventDefault();
      self.zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved = false;
      var ids = Object.keys(pointers);
      if (ids.length === 1) last = { x: e.clientX, y: e.clientY };
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    stage.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2 && pinch) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        self.zoomAt(pinch / dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = dist;
        moved = true;
      } else if (ids.length === 1 && last) {
        var dx = e.clientX - last.x, dy = e.clientY - last.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!moved) stage.setPointerCapture(e.pointerId);
        moved = true;
        var k = self.scale();
        self.setManual({ x: self.vb.x - dx / k, y: self.vb.y - dy / k, w: self.vb.w, h: self.vb.h });
        last = { x: e.clientX, y: e.clientY };
      }
    });
    function up(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!Object.keys(pointers).length) last = null;
    }
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
    // A drag that ends on a block link shouldn't follow the link.
    stage.addEventListener("click", function (e) {
      if (moved && e.target.closest("a")) e.preventDefault();
    }, true);
  };

  // Horizontal swipe on the rail steps through the flow on touch screens.
  Theater.prototype.bindSwipe = function () {
    var rail = this.d.querySelector(".th-rail"), start = null, self = this;
    rail.addEventListener("touchstart", function (e) {
      var t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    rail.addEventListener("touchend", function (e) {
      if (!start) return;
      var t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) self.act(dx < 0 ? "next" : "prev");
    }, { passive: true });
  };

  // ------------------------------------------------------------- playback

  Theater.prototype.play = function () {
    if (this.index >= this.flow.steps.length - 1) this.go(0, false);
    this.playing = true;
    this.updatePlay();
    this.schedule();
  };

  Theater.prototype.pause = function () {
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.updatePlay();
  };

  Theater.prototype.schedule = function () {
    clearTimeout(this.timer);
    if (!this.playing) return;
    var steps = this.flow.steps;
    // Autoplay stops at the end, and before a prediction prompt so the
    // reader gets to answer it before the next step gives it away.
    if (this.index >= steps.length - 1 || steps[this.index + 1].predict) return this.pause();
    var step = steps[this.index];
    var wait = (DWELL_MS + (step.travel && !reduceMotion ? TRAVEL_MS : 0)) / this.speed;
    if (reduceMotion) wait *= 1.5;
    this.timer = setTimeout(function () {
      this.go(this.index + 1, true);
      this.schedule();
    }.bind(this), wait);
  };

  Theater.prototype.updatePlay = function () {
    this.playBtn.innerHTML = icon(this.playing ? "pause" : "play");
    this.playBtn.setAttribute("aria-label", this.playing ? "Pause autoplay" : "Autoplay");
    this.playBtn.classList.toggle("is-on", this.playing);
  };

  Theater.prototype.go = function (i, animate) {
    this.index = i;
    this.manual = false;
    this.render(animate, false);
    if (this.inline) return;
    var hash = "#flow-" + this.flow.id + "=" + (i + 1);
    history.replaceState(history.state, "", location.pathname + location.search + hash);
  };

  // --------------------------------------------------------------- render

  Theater.prototype.render = function (animate, first) {
    var f = this.flow, i = this.index, step = f.steps[i], sc = f.sceneOf(i);
    var now = {}, past = {};
    if (step.recap) {
      f.steps.forEach(function (s) {
        (s.lit || []).forEach(function (k) { if (k.indexOf("block-") === 0) now[k] = true; });
      });
    } else {
      (step.lit || []).forEach(function (k) { now[k] = true; });
      travels(step).forEach(function (k) { now[k] = true; });
      // The trail restarts at each scene: an earlier scene's blocks belong
      // to a different role or machine and would only mislead.
      for (var j = sc.start; j < i; j++) {
        (f.steps[j].lit || []).forEach(function (k) { past[k] = true; });
        travels(f.steps[j]).forEach(function (k) { past[k] = true; });
      }
    }
    this.svg.classList.add("is-active");
    Object.keys(this.els).forEach(function (k) {
      this.els[k].classList.toggle("flow-now", !!now[k]);
      this.els[k].classList.toggle("flow-past", !now[k] && !!past[k]);
    }, this);
    this.renderRecap(step.recap);

    this.cells.forEach(function (c, k) {
      c.classList.toggle("is-current", k === i);
      c.classList.toggle("is-done", k < i);
      if (k === i) c.setAttribute("aria-current", "step");
      else c.removeAttribute("aria-current");
    });

    this.roleEl.hidden = !sc.role || !!step.recap;
    this.roleEl.textContent = sc.role || "";
    this.roleEl.setAttribute("data-role", (sc.role || "").toLowerCase());
    this.sceneEl.textContent = sc.title;
    this.countEl.textContent = "Step " + (i + 1) + " of " + f.steps.length;
    this.condEl.hidden = !step.condition;
    this.condEl.textContent = step.condition ? "Conditional: " + step.condition : "";
    // Things that happen at the same time as each other in this step,
    // named outright: a diagram drawn as a timeline cannot show overlap.
    this.parEl.hidden = !step.parallel;
    this.parList.innerHTML = "";
    (step.parallel || []).forEach(function (t) { this.parList.appendChild(el("li", null, t)); }, this);
    var t = f.text[i];
    this.captionEl.innerHTML = t.caption;
    this.chapterEl.hidden = !t.chapterHref;
    if (t.chapterHref) {
      this.chapterEl.href = t.chapterHref;
      this.chapterEl.textContent = t.chapterTitle;
    }
    var nextStep = f.steps[i + 1];
    this.predictEl.hidden = !(nextStep && nextStep.predict);
    if (nextStep && nextStep.predict) this.predictQ.textContent = nextStep.predict;
    this.renderInspector(i);
    this.camera(!first);
    this.renderToken(step, animate);
  };

  // Fields of the transaction in flight at this step. A field is marked
  // when the previous transaction carried the same field with a different
  // value, so the reader sees what changed.
  Theater.prototype.renderInspector = function (i) {
    var steps = this.flow.steps, pkt = steps[i].packet;
    this.insp.classList.toggle("is-state", !pkt && !!steps[i].state);
    if (!pkt && steps[i].state) return this.renderState(i);
    this.insp.hidden = !pkt;
    if (!pkt) return;
    var old = {};
    for (var j = i - 1; j >= 0; j--) {
      if (steps[j].packet) {
        steps[j].packet.headers.forEach(function (h) {
          h.fields.forEach(function (f) { old[h.name + "." + f[0]] = f[1]; });
        });
        break;
      }
    }
    this.inspLabel.textContent = pkt.label;
    this.ribbon.innerHTML = "";
    // One chip per part of the transaction, in the order the flow lists
    // them; the table below holds their fields.
    pkt.headers.forEach(function (h) {
      this.ribbon.appendChild(el("span", "th-chip", h.name));
    }, this);
    this.fields.innerHTML = "";
    pkt.headers.forEach(function (h) {
      var t = el("table", "th-hdr");
      t.appendChild(el("caption", null, h.name));
      h.fields.forEach(function (f) {
        var tr = el("tr"), key = h.name + "." + f[0];
        tr.appendChild(el("th", null, f[0]));
        var td = el("td", null, f[1]);
        if (key in old && old[key] !== f[1]) {
          tr.className = "is-changed";
          td.appendChild(el("span", "th-was", "was " + old[key]));
        }
        tr.appendChild(td);
        t.appendChild(tr);
      });
      this.fields.appendChild(t);
    }, this);
    // A step can carry both a transaction and the state it acts on; show
    // the state under the fields rather than dropping it.
    if (steps[i].state) this.fields.appendChild(this.stateTable(i, true));
  };

  // Context fields a state machine holds at this step. A field is marked
  // when it differs from the last state shown, unless this state is marked
  // fresh: a different object, where a comparison would mislead.
  Theater.prototype.renderState = function (i) {
    this.insp.hidden = false;
    this.inspLabel.textContent = this.flow.steps[i].state.label;
    this.ribbon.innerHTML = "";
    this.fields.innerHTML = "";
    this.fields.appendChild(this.stateTable(i, false));
  };

  Theater.prototype.stateTable = function (i, captioned) {
    var steps = this.flow.steps, st = steps[i].state, old = {};
    for (var j = st.fresh ? -1 : i - 1; j >= 0; j--) {
      if (steps[j].state) {
        steps[j].state.fields.forEach(function (f) { old[f[0]] = f[1]; });
        break;
      }
    }
    var t = el("table", "th-hdr");
    if (captioned) t.appendChild(el("caption", null, st.label));
    st.fields.forEach(function (f) {
      var tr = el("tr");
      tr.appendChild(el("th", null, f[0]));
      var td = el("td", null, f[1]);
      if (f[0] in old && old[f[0]] !== f[1]) {
        tr.className = "is-changed";
        td.appendChild(el("span", "th-was", "was " + old[f[0]]));
      }
      tr.appendChild(td);
      t.appendChild(tr);
    });
    return t;
  };

  // Recap: tag every block the flow touched with the role(s) that used it.
  Theater.prototype.renderRecap = function (on) {
    var layer = this.recapLayer;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    if (!on) return;
    var f = this.flow, roles = {};
    f.steps.forEach(function (s, i) {
      var role = f.sceneOf(i).role;
      if (!role) return;
      (s.lit || []).forEach(function (k) {
        if (k.indexOf("block-") !== 0) return;
        (roles[k] = roles[k] || {})[role] = true;
      });
    });
    Object.keys(roles).forEach(function (k) {
      var g = this.els[k];
      if (!g) return;
      var names = Object.keys(roles[k]);
      var kind = names.length > 1 ? "both" : names[0].toLowerCase();
      var b = this.bbox([g.querySelector("rect") || g]);
      var w = kind.length * 8 + 16;
      var badge = svgEl("g", {
        "class": "flow-recap-badge is-" + kind,
        transform: "translate(" + (b.x + b.w - w + 8) + "," + (b.y - 10) + ")",
      });
      badge.appendChild(svgEl("rect", { width: w, height: 18, rx: 9 }));
      var tx = svgEl("text", { x: w / 2, y: 13, "text-anchor": "middle" });
      tx.textContent = kind;
      badge.appendChild(tx);
      layer.appendChild(badge);
    }, this);
  };

  // ---------------------------------------------------------------- camera

  Theater.prototype.scale = function () {
    var r = this.stage.getBoundingClientRect();
    return Math.min(r.width / this.vb.w, r.height / this.vb.h);
  };

  Theater.prototype.fitScale = function () {
    var r = this.stage.getBoundingClientRect();
    return Math.min(r.width / this.full.w, r.height / this.full.h);
  };

  Theater.prototype.followOn = function () {
    return this.follow === null ? this.fitScale() < FOLLOW_BELOW : this.follow;
  };

  // Bounding box of elements in the root SVG's user space.
  Theater.prototype.bbox = function (els) {
    var svg = this.svg, inv = svg.getScreenCTM().inverse();
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    els.forEach(function (e) {
      var b = e.getBBox(), m = inv.multiply(e.getScreenCTM());
      [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .forEach(function (p) {
          var q = svg.createSVGPoint();
          q.x = p[0]; q.y = p[1];
          q = q.matrixTransform(m);
          x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
          x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
        });
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  Theater.prototype.target = function () {
    var step = this.flow.steps[this.index];
    if (!this.followOn() || step.recap) return this.full;
    var ids = (step.lit || []).slice();
    ids = ids.concat(travels(step));
    var els = ids.map(function (k) { return this.els[k]; }, this).filter(Boolean);
    if (!els.length) return this.full;
    var b = this.bbox(els), pad = 70;
    var r = this.stage.getBoundingClientRect(), aspect = r.width / r.height;
    var w = Math.max(b.w + 2 * pad, r.width / MAX_ZOOM);
    var h = Math.max(b.h + 2 * pad, r.height / MAX_ZOOM);
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    if (w >= this.full.w && h >= this.full.h) return this.full;
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    var x = w > this.full.w ? this.full.x + (this.full.w - w) / 2
      : Math.min(Math.max(cx - w / 2, this.full.x), this.full.x + this.full.w - w);
    var y = h > this.full.h ? this.full.y + (this.full.h - h) / 2
      : Math.min(Math.max(cy - h / 2, this.full.y), this.full.y + this.full.h - h);
    return { x: x, y: y, w: w, h: h };
  };

  Theater.prototype.camera = function (animate) {
    this.followBtn.setAttribute("aria-pressed", String(this.followOn()));
    this.recenterBtn.hidden = !this.manual;
    if (this.manual) return;
    var to = this.target(), from = { x: this.vb.x, y: this.vb.y, w: this.vb.w, h: this.vb.h };
    cancelAnimationFrame(this.camFrame);
    if (!animate || reduceMotion) return this.setVB(to);
    var start = null, self = this;
    function frame(ts) {
      if (start === null) start = ts;
      var t = ease(Math.min((ts - start) / CAMERA_MS, 1));
      self.setVB({
        x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t),
        w: lerp(from.w, to.w, t), h: lerp(from.h, to.h, t),
      });
      if (t < 1) self.camFrame = requestAnimationFrame(frame);
    }
    this.camFrame = requestAnimationFrame(frame);
  };

  Theater.prototype.setVB = function (vb) {
    this.vb = vb;
    this.svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
    this.sizeToken();
  };

  Theater.prototype.setManual = function (vb) {
    cancelAnimationFrame(this.camFrame);
    this.manual = true;
    this.recenterBtn.hidden = false;
    this.setVB(vb);
  };

  Theater.prototype.zoomAt = function (factor, cx, cy) {
    var r = this.stage.getBoundingClientRect(), k = this.scale();
    var f = Math.min(Math.max(this.vb.w * factor, r.width / 4), this.full.w * 2) / this.vb.w;
    // Keep the diagram point under the cursor fixed.
    var ox = (r.width - this.vb.w * k) / 2, oy = (r.height - this.vb.h * k) / 2;
    var px = this.vb.x + (cx - r.left - ox) / k, py = this.vb.y + (cy - r.top - oy) / k;
    this.setManual({
      x: px - (px - this.vb.x) * f, y: py - (py - this.vb.y) * f,
      w: this.vb.w * f, h: this.vb.h * f,
    });
  };

  // ----------------------------------------------------------------- token

  // One token per arrow the step travels. Arrows listed together are
  // paths running at the same time, so their tokens share one
  // clock instead of taking turns.
  Theater.prototype.renderToken = function (step, animate) {
    cancelAnimationFrame(this.tokenFrame);
    this.tokens.forEach(function (t) {
      if (t.g.parentNode) t.g.parentNode.removeChild(t.g);
    });
    this.tokens = [];
    var ids = travels(step), labels = [].concat(step.token || []);
    var to = this.manual ? this.vb : this.target();
    var r = this.stage.getBoundingClientRect();
    var k = Math.min(r.width / to.w, r.height / to.h);
    ids.forEach(function (id, i) {
      var g = this.els[id], shape = g && g.querySelector("path, line, polyline");
      if (!shape) return;
      var tok = svgEl("g", { "class": "flow-token", "aria-hidden": "true" });
      var rect = svgEl("rect", { rx: 6, height: 20, y: -10 });
      var text = svgEl("text", { y: 4, "text-anchor": "middle" });
      tok.appendChild(rect);
      tok.appendChild(text);
      // Same parent as the arrow's group, so the arrow's transforms apply.
      g.parentNode.appendChild(tok);
      // A token list labels each arrow in order; an entry may be
      // {label, wire} to style one as the transaction among local hand-offs.
      // Otherwise the first arrow carries the step's packet or token label.
      var spec = labels[i], label, wire;
      if (Array.isArray(step.token)) {
        label = (spec && spec.label !== undefined ? spec.label : spec) || "";
        wire = spec && spec.wire !== undefined ? !!spec.wire : i === 0 && !!step.packet;
      } else {
        label = i === 0 ? (step.packet && step.packet.label) || step.token || "" : "";
        wire = !!step.packet;
      }
      tok.classList.toggle("is-packet", wire);
      text.textContent = label;
      var w = label ? text.getComputedTextLength() + 18 : 18;
      rect.setAttribute("width", w);
      rect.setAttribute("x", -w / 2);

      // Stop short of the arrowhead so the token never covers the box it
      // is arriving at. The token is sized in screen pixels, so convert at
      // the camera scale this step settles on.
      var len = shape.getTotalLength();
      var a = shape.getPointAtLength(Math.max(len - 1, 0)), b = shape.getPointAtLength(len);
      var flat = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      var half = (flat ? w / 2 : 10) / k;
      this.tokens.push({
        g: tok, shape: shape, at: null,
        // Diagrams label horizontal arrows above the line, so ride below.
        drop: flat ? 13 : 0,
        stop: Math.max(len - half - 8 / k, len / 2),
      });
    }, this);
    if (!this.tokens.length) return;
    var self = this;
    function place(t) {
      self.tokens.forEach(function (tk) { tk.at = tk.shape.getPointAtLength(tk.stop * t); });
      self.sizeToken();
    }
    if (!animate || reduceMotion) return place(1);
    var start = null, dur = TRAVEL_MS / this.speed;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / dur, 1);
      place(ease(t));
      if (t < 1) self.tokenFrame = requestAnimationFrame(frame);
    }
    place(0);
    this.tokenFrame = requestAnimationFrame(frame);
  };

  // Tokens are drawn in screen pixels so their labels stay readable at any
  // zoom: each is scaled against the current camera.
  Theater.prototype.sizeToken = function () {
    var s = 1 / this.scale();
    this.tokens.forEach(function (tk) {
      if (!tk.at) return;
      tk.g.setAttribute(
        "transform",
        "translate(" + tk.at.x + "," + tk.at.y + ") scale(" + s + ") translate(0," + tk.drop + ")"
      );
    });
  };

  // ------------------------------------------------------------------ boot

  // A step's travel is one arrow id or a list of arrows taken at once.
  function travels(step) {
    return step.travel ? [].concat(step.travel) : [];
  }

  var theater = null;
  function getTheater() {
    return theater || (theater = new Theater());
  }

  // A figure marked data-inline plays where it stands, in its own theater.
  // It waits until it's visible, since the camera needs the stage's size.
  function mountInline(f) {
    var host = el("div", "dv-flow-inline");
    f.fig.after(host);
    f.fig.hidden = true;
    var t = null;
    var start = function () {
      if (!host.offsetWidth) return;
      if (!t) { t = new Theater(host); t.open(f, 0, true); }
      else t.camera(false);
    };
    if (window.ResizeObserver) new ResizeObserver(start).observe(host);
    start();
  }

  function boot() {
    if (typeof HTMLDialogElement !== "function") return; // the static figure stays
    var flows = {};
    document.querySelectorAll(".dv-flow").forEach(function (fig) {
      try {
        var f = new Flow(fig);
        if (fig.hasAttribute("data-inline")) return mountInline(f);
        flows[f.id] = f;
        var btn = fig.querySelector(".dv-flow-open");
        fig.querySelector(".dv-flow-bar").hidden = false;
        fig.classList.add("is-ready");
        var open = function () { getTheater().open(f, 0, false); };
        btn.addEventListener("click", open);
        fig.querySelector(".dv-flow-poster img").addEventListener("click", open);
      } catch (err) {
        if (window.console) console.error("flow player:", err);
      }
    });
    function fromHash() {
      var m = /^#flow-(.+)=(\d+)$/.exec(location.hash);
      if (m && flows[m[1]]) {
        var t = getTheater();
        if (!t.d.open || t.flow !== flows[m[1]]) t.open(flows[m[1]], parseInt(m[2], 10) - 1, true);
      }
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    // Printed pages get every step written out.
    window.addEventListener("beforeprint", function () {
      document.querySelectorAll(".dv-flow-steps").forEach(function (d) { d.open = true; });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
