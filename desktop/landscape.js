// Local vector artwork only. The time engine supplies its colours and sky positions.
(() => {
  const landscape = document.querySelector('.landscape');
  if (!landscape) return;
  const stars = [
    [68, 174, 1.1, .55], [126, 78, 1.4, .75], [183, 217, .8, .42], [246, 116, 1, .54],
    [312, 54, .9, .4], [384, 164, 1.25, .65], [455, 91, .8, .4], [511, 228, 1.1, .5],
    [568, 36, 1.2, .55], [633, 154, .9, .45], [682, 79, 1.3, .7], [744, 257, .8, .35],
    [806, 126, 1.15, .65], [853, 42, .85, .4], [907, 197, 1, .48], [966, 88, 1.3, .7],
    [1037, 151, .8, .4], [1102, 34, .95, .5], [1160, 205, 1.1, .52], [1213, 113, .9, .48],
    [1276, 66, 1.3, .66], [1344, 173, .75, .45], [1405, 105, 1.1, .62], [1478, 43, .8, .4],
    [1542, 216, 1.2, .6], [1575, 118, .9, .45], [58, 316, .85, .35], [532, 336, .8, .35],
    [885, 319, 1, .42], [1009, 278, .75, .35], [1196, 305, .8, .38], [1510, 338, .8, .35],
  ];
  const pines = [
    [8, 770, 1.12], [49, 806, .75], [93, 801, 1.18], [126, 831, .66], [179, 851, .9],
    [261, 892, .68], [326, 927, .48], [1219, 941, .58], [1277, 909, .74], [1335, 869, 1.0],
    [1384, 862, .65], [1441, 806, 1.16], [1485, 833, .77], [1536, 765, 1.35], [1589, 801, .96],
  ];
  landscape.setAttribute('aria-hidden', 'true');
  landscape.innerHTML = `
    <div class="scene-sky"></div>
    <div class="scene-horizon-glow"></div>
    <svg class="scene-stars" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
      ${stars.map(([cx, cy, r, opacity]) => `<circle cx="${cx}" cy="${cy}" r="${r}" opacity="${opacity}"/>`).join('')}
    </svg>
    <div class="scene-sun"></div>
    <div class="scene-moon"><svg viewBox="0 0 64 64" focusable="false"><path d="M44.6 4.8A28 28 0 1 0 59.2 46.8A28.5 28.5 0 0 1 44.6 4.8Z"/></svg></div>
    <div class="weather-clouds"></div>
    <svg class="alpine-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient id="alpine-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--mist, #c5d3cb)" stop-opacity="0"/>
          <stop offset=".5" stop-color="var(--mist, #c5d3cb)" stop-opacity=".24"/>
          <stop offset="1" stop-color="var(--mist, #c5d3cb)" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="alpine-low-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--mist, #c5d3cb)" stop-opacity="0"/>
          <stop offset=".55" stop-color="var(--mist, #c5d3cb)" stop-opacity=".15"/>
          <stop offset="1" stop-color="var(--mist, #c5d3cb)" stop-opacity="0"/>
        </linearGradient>
        <g id="alpine-pine">
          <path d="M0 0-5 13-3 12-11 27-7 25-17 42-11 39-24 61-17 58-30 76-4 70-3 90H3L4 70 29 77 17 58 23 61 11 39 17 42 7 25 11 27 3 12 5 13Z"/>
        </g>
      </defs>

      <!-- Distant shoulders leave an open, quiet valley behind the cards. -->
      <path class="alpine-peak-far" data-ridge="distant-west" d="M-40 483 16 443 48 414 78 422 113 385 143 354 162 363 184 340 217 290 231 304 254 282 283 309 310 303 332 332 359 352 385 365 410 389 438 387 468 415 495 430 526 426 562 456 597 465 638 497 681 505 720 533C811 552 885 586 943 612L1010 1000H-40Z"/>
      <path class="alpine-peak-far alpine-far-east" data-ridge="distant-east" d="M532 637C646 553 705 542 758 511L804 499 837 467 867 474 895 438 921 427 950 392 969 403 1006 357 1032 346 1063 304 1080 315 1108 272 1122 281 1144 251 1171 270 1189 264 1215 303 1241 316 1270 349 1293 344 1310 376 1339 387 1371 414 1400 418 1438 444 1483 443 1531 475 1640 486V1000H532Z"/>

      <!-- Weathered rock faces: broken shoulders and uneven summit shelves. -->
      <path class="alpine-peak-mid" data-ridge="western-summit" d="M-40 539 12 510 58 475 81 484 109 456 132 424 153 421 181 385 197 390 222 351 238 340 254 314 269 322 294 282 304 294 324 273 341 291 350 288 376 327 396 342 413 369 431 372 455 406 482 417 497 441 520 447 548 483 575 491 605 524 629 531 657 558 689 563 729 603 771 620C865 652 974 693 1086 723L1203 1000H-40Z"/>
      <path class="alpine-facet alpine-facet-west" d="M324 273 307 342 279 392 300 433 271 483 236 525 211 602 280 572 324 498 351 470 352 408 338 372 352 326 341 291Z"/>
      <path class="alpine-facet alpine-facet-west-secondary" d="M254 314 238 367 215 395 214 434 184 460 166 519 113 563 173 538 231 471 240 421 269 392 277 350Z"/>

      <path class="alpine-ridge-back" data-ridge="eastern-summit" d="M468 759C582 692 650 697 728 649L770 628 809 593 840 590 863 565 882 568 919 531 938 509 961 512 983 478 1009 462 1033 427 1055 421 1081 387 1104 393 1123 366 1143 355 1174 312 1188 317 1211 285 1229 294 1248 268 1265 289 1284 281 1309 320 1327 329 1352 362 1377 369 1406 400 1435 405 1468 439 1501 444 1533 473 1566 478 1640 524V1000H468Z"/>
      <path class="alpine-facet alpine-facet-east" d="M1248 268 1232 347 1254 383 1239 426 1268 469 1274 527 1321 582 1384 620 1343 562 1322 501 1298 460 1290 406 1266 370 1265 320Z"/>
      <path class="alpine-facet alpine-facet-east-secondary" d="M1174 312 1151 371 1159 405 1137 439 1130 489 1086 534 1062 603 1123 566 1167 499 1188 465 1179 413 1194 374 1188 341Z"/>

      <path class="alpine-mist-band" fill="url(#alpine-mist)" d="M-60 568C191 496 412 578 632 646S1016 628 1228 557 1469 566 1660 607V806H-60Z"/>

      <!-- Softer foothills overlap the sharper alpine forms. -->
      <path class="alpine-ridge-middle" data-ridge="middle-foothills" d="M-40 662C22 640 62 625 94 608L130 592 155 597 185 580 219 577 248 568C293 575 322 601 361 616L396 622 424 641 454 643C508 665 547 698 594 711L634 718 662 734C743 755 809 774 877 766L927 746 952 745 981 725C1036 711 1070 677 1119 661L1157 641 1192 643 1226 626 1255 625C1321 609 1370 628 1414 646L1455 659 1480 655 1521 673 1554 679 1640 710V1000H-40Z"/>
      <path class="alpine-low-mist-band" fill="url(#alpine-low-mist)" d="M-50 747C223 663 439 746 622 794S1012 810 1230 712 1494 698 1660 741V907H-50Z"/>

      <path class="alpine-ridge-front" data-ridge="near-foothills" d="M-40 725 6 734 43 722C99 735 126 748 166 761L204 785 232 786C290 808 322 834 371 851L409 860 446 883C523 915 594 928 661 932 729 936 791 920 859 898L895 879 921 881C974 861 1004 839 1052 823L1087 803 1115 805 1150 785C1213 764 1257 741 1300 739L1341 724 1375 728C1445 724 1494 700 1539 709L1580 701 1640 720V1000H-40Z"/>
      <path class="alpine-forest-ground" data-ridge="forest-floor" d="M-40 833C84 843 172 899 270 940 393 992 494 1020 605 1020H993C1093 993 1204 960 1302 916 1414 868 1515 852 1640 864V1040H-40Z"/>
      <g class="alpine-pines">${pines.map(([x, y, scale]) => `<use href="#alpine-pine" transform="translate(${x} ${y}) scale(${scale})"/>`).join('')}</g>
    </svg>
    <div class="weather-fog"></div>
    <canvas class="weather-rain" aria-hidden="true"></canvas>
    <svg class="weather-snow" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs><pattern id="alpine-snow" width="340" height="300" patternUnits="userSpaceOnUse"><g fill="#eff5ee"><circle cx="31" cy="46" r="1.4" opacity=".8"/><circle cx="174" cy="17" r="1.7" opacity=".7"/><circle cx="286" cy="101" r="1.2" opacity=".65"/><circle cx="104" cy="188" r="2" opacity=".75"/><circle cx="231" cy="258" r="1.45" opacity=".7"/></g></pattern></defs><g class="weather-snow-motion"><rect x="-400" y="-400" width="2400" height="1800" fill="url(#alpine-snow)"/></g>
    </svg>`;
  // Individually recycled drops: no texture tile, shared loop or synchronized reset.
  const canvas = landscape.querySelector('.weather-rain'), context = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  let width = 1, height = 1, drops = [], frame = 0, last = 0, elapsed = 0;
  let intensity = 0, storm = false, nextGlow = 10 + Math.random() * 16, glowAge = 10;
  const random = (min, max) => min + Math.random() * (max - min);
  function drop(initial = false) {
    const depth = Math.pow(Math.random(), 1.5);
    return { x: random(-80, width + 180), y: initial ? random(-50, height) : random(-100, -25),
      depth, speed: 330 + depth * 650 + random(-55, 55), length: 7 + depth * 23,
      alpha: random(.12, .25) + depth * .19, thickness: .45 + depth * .85 };
  }
  function resizeRain() {
    const bounds = landscape.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    drops = []; syncRain();
  }
  function paint(dt) {
    context.clearRect(0, 0, width, height);
    elapsed += dt;
    // Gusts are decorative, not measured wind; several periods avoid a short loop.
    const gust = Math.sin(elapsed * .43) * .075 + Math.sin(elapsed * .91 + 2) * .035;
    const slant = -.16 - gust - (storm ? .12 : 0);
    const count = Math.min(600, Math.round(width * height / 4300 * (.45 + intensity * 1.7)));
    while (drops.length < count) drops.push(drop(true));
    drops.length = count;
    for (let i = 0; i < count; i++) {
      let p = drops[i];
      const speed = p.speed * (.85 + intensity * .4 + (storm ? .18 : 0));
      p.y += speed * dt; p.x += speed * slant * dt;
      if (p.y > height + 40 || p.x < -100) p = drops[i] = drop();
      const length = p.length * (.85 + intensity * .35);
      context.strokeStyle = `rgba(210,231,240,${p.alpha})`;
      context.lineWidth = p.thickness;
      context.beginPath(); context.moveTo(p.x, p.y);
      context.lineTo(p.x - slant * length, p.y - length); context.stroke();
    }
    // Slow, low-contrast in-cloud illumination; no rapid flashes or audio.
    if (storm && !reduced.matches && dt) {
      nextGlow -= dt; glowAge += dt;
      if (nextGlow <= 0) { glowAge = 0; nextGlow = random(14, 32); }
      if (glowAge < 1.8) {
        const alpha = Math.sin(glowAge / 1.8 * Math.PI) * .11;
        const glow = context.createRadialGradient(width * .72, 0, 0, width * .72, 0, width * .8);
        glow.addColorStop(0, `rgba(210,225,255,${alpha})`); glow.addColorStop(1, 'rgba(210,225,255,0)');
        context.fillStyle = glow; context.fillRect(0, 0, width, height);
      }
    }
  }
  function tick(time) {
    frame = 0;
    if (reduced.matches || document.hidden || root.dataset.sceneHidden === 'true' || !intensity) { last = 0; return; }
    if (last && time - last < 1000 / 30) { frame = requestAnimationFrame(tick); return; }
    const dt = last ? Math.min((time - last) / 1000, .065) : 0;
    last = time; paint(dt); frame = requestAnimationFrame(tick);
  }
  function syncRain() {
    if (!context) return;
    cancelAnimationFrame(frame); frame = 0; last = 0;
    storm = root.dataset.weather === 'storm';
    intensity = Math.max(0, Math.min(1, parseFloat(root.style.getPropertyValue('--weather-rain')) || 0));
    const visible = !document.hidden && root.dataset.sceneHidden !== 'true';
    if (!visible || !intensity) { context.clearRect(0, 0, width, height); glowAge = 10; return; }
    paint(0);
    if (!reduced.matches) frame = requestAnimationFrame(tick);
  }
  new MutationObserver(syncRain).observe(root, { attributes: true, attributeFilter: ['data-weather', 'data-scene-hidden', 'style'] });
  new ResizeObserver(resizeRain).observe(landscape);
  reduced.addEventListener('change', syncRain);
  resizeRain();
  const updateVisibility = () => { document.documentElement.dataset.sceneHidden = String(document.hidden); syncRain(); };
  updateVisibility();
  document.addEventListener('visibilitychange', updateVisibility);
  window.addEventListener('pageshow', updateVisibility);
  window.addEventListener('pagehide', () => { document.documentElement.dataset.sceneHidden = 'true'; });
})();
